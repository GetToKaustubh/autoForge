import { redis } from '@/lib/cache/redis'
import { db } from '@/lib/db'
import { youtubeChannels } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { format } from 'date-fns'

export const QUOTA_COSTS = {
  'videos.insert': 1600,
  'videos.update': 50,
  'videos.list': 1,
  'channels.list': 1,
  'search.list': 100,
  'captions.insert': 400,
  'thumbnails.set': 50,
  'analytics.query': 1,
  'playlists.list': 1,
  'playlistItems.insert': 50,
} as const

export type YouTubeOperation = keyof typeof QUOTA_COSTS

/**
 * Atomically checks and deducts YouTube API quota for a channel.
 * Uses Upstash Redis for race-condition-safe atomic decrement.
 * Mirrors the deduction to the DB for persistence across Redis restarts.
 */
export async function checkAndDeductQuota(
  channelId: string,
  operation: YouTubeOperation
): Promise<{ allowed: boolean; remainingQuota: number; cost: number }> {
  const cost = QUOTA_COSTS[operation]
  const today = format(new Date(), 'yyyy-MM-dd')
  const key = `quota:${channelId}:${today}`

  // Ensure the key is initialized with today's remaining quota
  const channel = await db.query.youtubeChannels.findFirst({
    where: eq(youtubeChannels.id, channelId),
    columns: { quotaUsedToday: true, quotaLimitDaily: true, quotaResetAt: true },
  })

  if (!channel) throw new Error(`Channel ${channelId} not found`)

  const quotaRemaining = channel.quotaLimitDaily - channel.quotaUsedToday

  // Initialize Redis key if missing (TTL: 25 hours to survive midnight boundary)
  const exists = await redis.exists(key)
  if (!exists) {
    await redis.set(key, quotaRemaining, { ex: 90000 })
  }

  // Atomic decrement
  const remaining = await redis.decrby(key, cost)

  if (remaining < 0) {
    // Roll back Redis — quota exceeded
    await redis.incrby(key, cost)

    await db
      .update(youtubeChannels)
      .set({ status: 'quota_exceeded' })
      .where(eq(youtubeChannels.id, channelId))

    return { allowed: false, remainingQuota: remaining + cost, cost }
  }

  // Mirror to DB (non-atomic is fine — Redis is source of truth for race conditions)
  await db
    .update(youtubeChannels)
    .set({ quotaUsedToday: sql`quota_used_today + ${cost}` })
    .where(eq(youtubeChannels.id, channelId))

  return { allowed: true, remainingQuota: remaining, cost }
}

/**
 * Refunds previously-deducted quota after a checkAndDeductQuota succeeded
 * but the actual API call then failed (e.g. upload errored after the
 * pre-check passed). Keeps "quota used" meaning "quota actually spent
 * on YouTube", not "quota attempted".
 */
export async function refundQuota(channelId: string, operation: YouTubeOperation): Promise<void> {
  const cost = QUOTA_COSTS[operation]
  const today = format(new Date(), 'yyyy-MM-dd')
  const key = `quota:${channelId}:${today}`

  await redis.incrby(key, cost)

  await db
    .update(youtubeChannels)
    .set({ quotaUsedToday: sql`GREATEST(quota_used_today - ${cost}, 0)` })
    .where(eq(youtubeChannels.id, channelId))
}

export function todayPacificDate(): string {
  // YouTube quota resets at midnight Pacific Time
  return new Date()
    .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}
