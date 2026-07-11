import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, organizationMembers, users, youtubeChannels } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { redis } from '@/lib/cache/redis'
import { QUOTA_COSTS } from '@/lib/utils/quota'

export async function GET(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify access
  const [member] = await db
    .select({ orgDbId: organizations.id })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.clerkOrgId, orgId), eq(users.clerkId, userId)))
    .limit(1)

  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [channel] = await db
    .select({
      quotaUsedToday: youtubeChannels.quotaUsedToday,
      quotaLimitDaily: youtubeChannels.quotaLimitDaily,
      status: youtubeChannels.status,
    })
    .from(youtubeChannels)
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        eq(youtubeChannels.organizationId, member.orgDbId),
        isNull(youtubeChannels.deletedAt)
      )
    )
    .limit(1)

  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get live quota from Redis (more accurate than DB which is mirrored)
  const redisKey = `quota:${channelId}`
  const redisQuota = await redis.get<number>(redisKey)
  const quotaUsed = redisQuota ?? channel.quotaUsedToday
  const quotaLimit = channel.quotaLimitDaily
  const quotaRemaining = Math.max(0, quotaLimit - quotaUsed)
  const percentUsed = Math.round((quotaUsed / quotaLimit) * 100)

  // Calculate how many uploads remain today
  const uploadsRemaining = Math.floor(quotaRemaining / QUOTA_COSTS['videos.insert'])

  return NextResponse.json({
    quota: {
      used: quotaUsed,
      limit: quotaLimit,
      remaining: quotaRemaining,
      percentUsed,
      uploadsRemaining,
      status: channel.status,
      costs: QUOTA_COSTS,
    },
  })
}
