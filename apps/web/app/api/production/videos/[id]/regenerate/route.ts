import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videos } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

// Same scene shape New Video accepts - regenerating an existing video reuses
// the exact same generation path (VIDEO_GENERATION task), just targeting the
// existing videoId instead of inserting a new row, so the result overwrites
// what's there instead of creating a second video.
const regenerateSchema = z.object({
  scriptId: z.string().uuid().optional(),
  voiceGenId: z.string().uuid().optional(),
  scenes: z.array(z.object({
    scene_index: z.number().int(),
    prompt: z.string().min(5).max(2000),
    duration_sec: z.number().min(1, 'Scene duration must be at least 1 second').max(120, 'Scene duration cannot exceed 120 seconds').default(5),
    reference_image_url: z.string().url().optional(),
    visual_type: z.enum(['auto', 'stock', 'ai-image', 'runway', 'pika']).optional(),
  })).min(1),
  provider: z.enum(['stock', 'ai-image', 'runway', 'pika']).default('stock'),
  aspectRatio: z.enum(['16:9', '9:16']).default('16:9'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.api, `${orgId}:videos`)
  if (rateLimitRes) return rateLimitRes

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = regenerateSchema.safeParse(body)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const detail = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request'
    return NextResponse.json({ error: detail, details: parsed.error.flatten() }, { status: 400 })
  }

  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.organizationId, member.orgDbId), isNull(videos.deletedAt)))
    .limit(1)
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (video.pipelineStage === 'uploaded' || video.pipelineStage === 'published') {
    return NextResponse.json({ error: 'Cannot regenerate an uploaded or published video' }, { status: 409 })
  }
  if (video.pipelineStage === 'scenes_generating') {
    return NextResponse.json({ error: 'This video is already generating' }, { status: 409 })
  }

  // Shorts stay vertical regardless of what's sent - same server-side
  // defense as the New Video creation route.
  const aspectRatio = video.contentType === 'short' ? '9:16' : parsed.data.aspectRatio

  if (parsed.data.scriptId || parsed.data.voiceGenId) {
    await db
      .update(videos)
      .set({
        scriptId: parsed.data.scriptId ?? video.scriptId,
        voiceGenId: parsed.data.voiceGenId ?? video.voiceGenId,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, id))
  }

  // Old render is stale the moment new scenes start generating - clear it so
  // the UI doesn't keep offering a "Preview final video" link to content
  // that's about to be replaced.
  await db
    .update(videos)
    .set({
      finalVideoUrl: null,
      rawVideoUrl: null,
      cloudinaryPublicId: null,
      durationSec: null,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, id))

  const handle = await tasks.trigger(TASK_IDS.VIDEO_GENERATION, {
    videoId: id,
    organizationId: member.orgDbId,
    channelId: video.channelId,
    scenes: parsed.data.scenes,
    provider: parsed.data.provider,
    aspectRatio,
  })

  return NextResponse.json({ videoId: id, triggerJobId: handle.id, stage: 'scenes_generating' }, { status: 202 })
}
