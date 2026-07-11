import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scheduledUploads, videos, youtubeChannels } from '@/lib/db/schema'
import { eq, and, desc, isNull, gte } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'

const scheduleSchema = z.object({
  videoId: z.string().uuid(),
  channelId: z.string().uuid(),
  scheduledAt: z.string().datetime(), // ISO 8601
  timezone: z.string().default('UTC'),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.api, `${orgId}:schedule`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = scheduleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canAdmin(member.role)) return NextResponse.json({ error: 'Insufficient permissions — admin required' }, { status: 403 })

  const scheduledAt = new Date(parsed.data.scheduledAt)
  if (scheduledAt <= new Date()) {
    return NextResponse.json({ error: 'Scheduled time must be in the future' }, { status: 400 })
  }

  const [video] = await db
    .select({ id: videos.id, pipelineStage: videos.pipelineStage, finalVideoUrl: videos.finalVideoUrl })
    .from(videos)
    .where(and(
      eq(videos.id, parsed.data.videoId),
      eq(videos.organizationId, member.orgDbId),
      isNull(videos.deletedAt),
    ))
    .limit(1)

  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  if (!video.finalVideoUrl) {
    return NextResponse.json({ error: 'Video must be rendered before scheduling' }, { status: 409 })
  }

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

  const [scheduled] = await db
    .insert(scheduledUploads)
    .values({
      organizationId: member.orgDbId,
      channelId: parsed.data.channelId,
      videoId: parsed.data.videoId,
      createdBy: member.userDbId,
      scheduledAt,
      timezone: parsed.data.timezone,
      status: 'scheduled',
    })
    .returning()

  // Update video stage
  await db
    .update(videos)
    .set({ pipelineStage: 'scheduled', updatedAt: new Date() })
    .where(eq(videos.id, parsed.data.videoId))

  return NextResponse.json(scheduled, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  const upcoming = url.searchParams.get('upcoming') === 'true'
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const conditions = [eq(scheduledUploads.organizationId, member.orgDbId)]
  if (channelId) conditions.push(eq(scheduledUploads.channelId, channelId))
  if (upcoming) conditions.push(gte(scheduledUploads.scheduledAt, new Date()))

  const results = await db
    .select()
    .from(scheduledUploads)
    .where(and(...conditions))
    .orderBy(desc(scheduledUploads.scheduledAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ schedules: results, limit, offset })
}
