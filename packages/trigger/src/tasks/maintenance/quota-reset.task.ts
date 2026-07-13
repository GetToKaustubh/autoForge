import { schedules, logger } from '@trigger.dev/sdk'

// Runs daily at 00:05 Pacific Time (08:05 UTC)
// YouTube quota resets at midnight Pacific Time
export const quotaResetTask = schedules.task({
  id: 'quota-reset',
  cron: '5 8 * * *', // 08:05 UTC = 00:05 PT (standard time)

  run: async () => {
    logger.info('Running daily YouTube quota reset')

    const { db } = await import('../../lib/db')
    const { youtubeChannels } = await import('../../lib/db/schema')
    const { sql } = await import('drizzle-orm')
    const { redis } = await import('@/lib/cache/redis')

    const result = await db
      .update(youtubeChannels)
      .set({
        quotaUsedToday: 0,
        quotaResetAt: new Date(),
        // Re-activate quota_exceeded channels
        status: sql`CASE WHEN status = 'quota_exceeded' THEN 'active' ELSE status END`,
        updatedAt: new Date(),
      })
      .returning({ id: youtubeChannels.id })

    // The DB update above is a mirror; Redis's per-day key is the real quota
    // gate checkAndDeductQuota enforces. If this runs same-day as a manual
    // reset (not just the midnight cron), that key still exists with the
    // depleted count and would keep blocking uploads regardless of the DB
    // reset - clear it explicitly so a manual re-run actually takes effect.
    const today = new Date().toISOString().slice(0, 10)
    await Promise.all(result.map((c) => redis.del(`quota:${c.id}:${today}`)))

    logger.info(`YouTube quota reset completed: ${result.length} channels reset`)
    return { channelsReset: result.length }
  },
})
