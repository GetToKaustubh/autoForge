import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, youtubeChannels } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitResult = await applyRateLimit(rateLimiters.api, userId)
  if (rateLimitResult) return rateLimitResult

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.clerkOrgId, orgId))
    .limit(1)

  if (!org) return NextResponse.json({ channels: [] })

  const channels = await db
    .select({
      id: youtubeChannels.id,
      ytChannelId: youtubeChannels.ytChannelId,
      channelName: youtubeChannels.channelName,
      channelHandle: youtubeChannels.channelHandle,
      channelThumbnail: youtubeChannels.channelThumbnail,
      subscriberCount: youtubeChannels.subscriberCount,
      videoCount: youtubeChannels.videoCount,
      quotaUsedToday: youtubeChannels.quotaUsedToday,
      quotaLimitDaily: youtubeChannels.quotaLimitDaily,
      status: youtubeChannels.status,
      isPrimary: youtubeChannels.isPrimary,
      lastSyncedAt: youtubeChannels.lastSyncedAt,
      createdAt: youtubeChannels.createdAt,
    })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.organizationId, org.id), isNull(youtubeChannels.deletedAt)))
    .orderBy(youtubeChannels.isPrimary, youtubeChannels.createdAt)

  return NextResponse.json({ channels })
}
