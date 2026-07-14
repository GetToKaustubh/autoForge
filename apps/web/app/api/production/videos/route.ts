import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videos, youtubeChannels } from '@/lib/db/schema'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const createVideoSchema = z.object({
  channelId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional(),
  scriptId: z.string().uuid().optional(),
  voiceGenId: z.string().uuid().optional(),
  thumbnailId: z.string().uuid().optional(),
  // If scenes provided, immediately start video generation
  scenes: z.array(z.object({
    scene_index: z.number().int(),
    // Runway/Pika accept detailed cinematic prompts well past a tweet's
    // length - 500 was rejecting real-world scene descriptions (confirmed
    // live: a batch of 13 cinematic prompts, 8 of them 500-627 chars).
    prompt: z.string().min(5).max(2000),
    duration_sec: z.number().default(5),
    reference_image_url: z.string().url().optional(),
  })).optional(),
  provider: z.enum(['stock', 'ai-image', 'runway', 'pika']).default('stock'),
  aspectRatio: z.enum(['16:9', '9:16']).default('16:9'),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.api, `${orgId}:videos`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = createVideoSchema.safeParse(body)
  if (!parsed.success) {
    // flatten() only surfaces top-level field errors - nested issues like
    // scenes[2].prompt (e.g. a manually-typed scene line under 5 chars)
    // don't show up in it at all, so the client only ever saw a bare
    // "Invalid request" with no way to tell which line was the problem.
    const firstIssue = parsed.error.issues[0]
    const detail = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request'
    return NextResponse.json({ error: detail, details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(
      eq(youtubeChannels.id, parsed.data.channelId),
      eq(youtubeChannels.organizationId, member.orgDbId),
      isNull(youtubeChannels.deletedAt),
    ))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const [video] = await db
    .insert(videos)
    .values({
      organizationId: member.orgDbId,
      channelId: parsed.data.channelId,
      createdBy: member.userDbId,
      title: parsed.data.title,
      description: parsed.data.description,
      scriptId: parsed.data.scriptId,
      voiceGenId: parsed.data.voiceGenId,
      thumbnailId: parsed.data.thumbnailId,
      pipelineStage: 'draft',
    })
    .returning()

  if (!video) return NextResponse.json({ error: 'Failed to create video' }, { status: 500 })

  // Optionally kick off scene generation immediately
  if (parsed.data.scenes && parsed.data.scenes.length > 0) {
    const handle = await tasks.trigger(TASK_IDS.VIDEO_GENERATION, {
      videoId: video.id,
      organizationId: member.orgDbId,
      channelId: parsed.data.channelId,
      scenes: parsed.data.scenes,
      provider: parsed.data.provider,
      aspectRatio: parsed.data.aspectRatio,
    })

    const [updated] = await db
      .update(videos)
      .set({ pipelineStage: 'scenes_generating' })
      .where(eq(videos.id, video.id))
      .returning()

    return NextResponse.json({ ...updated, triggerJobId: handle.id }, { status: 201 })
  }

  return NextResponse.json(video, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  const stage = url.searchParams.get('stage')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const conditions = [
    eq(videos.organizationId, member.orgDbId),
    isNull(videos.deletedAt),
  ]
  if (channelId) conditions.push(eq(videos.channelId, channelId))
  if (stage) conditions.push(eq(videos.pipelineStage, stage as 'draft' | 'script_ready' | 'voice_ready' | 'scenes_generating' | 'scenes_ready' | 'editing' | 'render_queue' | 'rendered' | 'seo_optimized' | 'scheduled' | 'uploaded' | 'published' | 'failed'))

  const results = await db
    .select()
    .from(videos)
    .where(and(...conditions))
    .orderBy(desc(videos.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ videos: results, limit, offset })
}
