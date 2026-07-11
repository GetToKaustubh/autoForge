import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { youtubeChannels } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember } from '@/lib/auth/get-member'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const channels = await db
    .select({
      id: youtubeChannels.id,
      channelName: youtubeChannels.channelName,
      channelHandle: youtubeChannels.channelHandle,
      channelThumbnail: youtubeChannels.channelThumbnail,
      status: youtubeChannels.status,
      quotaUsedToday: youtubeChannels.quotaUsedToday,
      quotaLimitDaily: youtubeChannels.quotaLimitDaily,
      quotaResetAt: youtubeChannels.quotaResetAt,
      lastSyncedAt: youtubeChannels.lastSyncedAt,
    })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.organizationId, member.orgDbId), isNull(youtubeChannels.deletedAt)))

  const totalUsed = channels.reduce((s, c) => s + (c.quotaUsedToday ?? 0), 0)
  const totalLimit = channels.reduce((s, c) => s + (c.quotaLimitDaily ?? 10000), 0)

  return NextResponse.json({ channels, totalUsed, totalLimit })
}
