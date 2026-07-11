import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videos, youtubeChannels } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const uploadSchema = z.object({
  videoId: z.string().uuid(),
  channelId: z.string().uuid(),
  ytTitle: z.string().min(1).max(100).optional(),
  ytDescription: z.string().max(5000).optional(),
  ytTags: z.array(z.string().max(100)).max(500).optional(),
  ytCategoryId: z.string().default('22'), // 22 = People & Blogs
  ytVisibility: z.enum(['public', 'private', 'unlisted']).default('private'),
  ytMadeForKids: z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.uploads, `${orgId}:uploads`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = uploadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  // Only admin+ can initiate YouTube uploads
  if (!canAdmin(member.role)) return NextResponse.json({ error: 'Insufficient permissions — admin required' }, { status: 403 })

  const [video] = await db
    .select({
      id: videos.id,
      pipelineStage: videos.pipelineStage,
      finalVideoUrl: videos.finalVideoUrl,
      ytTitle: videos.ytTitle,
      ytDescription: videos.ytDescription,
      ytTags: videos.ytTags,
    })
    .from(videos)
    .where(and(
      eq(videos.id, parsed.data.videoId),
      eq(videos.organizationId, member.orgDbId),
      isNull(videos.deletedAt),
    ))
    .limit(1)

  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  if (!video.finalVideoUrl) {
    return NextResponse.json({ error: 'Video has no final render yet — complete the pipeline first' }, { status: 409 })
  }

  const allowedStages = ['rendered', 'seo_optimized', 'scheduled']
  if (!allowedStages.includes(video.pipelineStage)) {
    return NextResponse.json(
      { error: `Cannot upload: video must be rendered first (currently: ${video.pipelineStage})` },
      { status: 409 }
    )
  }

  const [channel] = await db
    .select({ id: youtubeChannels.id, quotaUsedToday: youtubeChannels.quotaUsedToday })
    .from(youtubeChannels)
    .where(and(
      eq(youtubeChannels.id, parsed.data.channelId),
      eq(youtubeChannels.organizationId, member.orgDbId),
      isNull(youtubeChannels.deletedAt),
    ))
    .limit(1)

  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  // Quota check: upload costs 1600 units
  const quotaAfter = (channel.quotaUsedToday ?? 0) + 1600
  if (quotaAfter > 10000) {
    return NextResponse.json({
      error: 'YouTube API quota would be exceeded. Try again after midnight Pacific Time.',
      quotaUsed: channel.quotaUsedToday,
      quotaLimit: 10000,
    }, { status: 429 })
  }

  // Update video with final YT metadata
  const finalTitle = parsed.data.ytTitle ?? video.ytTitle ?? 'Untitled Video'
  const finalDescription = parsed.data.ytDescription ?? video.ytDescription ?? ''
  const finalTags = parsed.data.ytTags ?? video.ytTags ?? []

  await db
    .update(videos)
    .set({
      ytTitle: finalTitle,
      ytDescription: finalDescription,
      ytTags: finalTags,
      ytCategoryId: parsed.data.ytCategoryId,
      ytVisibility: parsed.data.ytVisibility,
      ytMadeForKids: parsed.data.ytMadeForKids,
      pipelineStage: 'scheduled',
      updatedAt: new Date(),
    })
    .where(eq(videos.id, parsed.data.videoId))

  const handle = await tasks.trigger(TASK_IDS.YOUTUBE_UPLOAD, {
    videoId: parsed.data.videoId,
    channelId: parsed.data.channelId,
    organizationId: member.orgDbId,
  })

  return NextResponse.json({
    videoId: parsed.data.videoId,
    triggerJobId: handle.id,
    status: 'uploading',
    message: 'Upload started — this may take several minutes for large files',
  }, { status: 202 })
}
