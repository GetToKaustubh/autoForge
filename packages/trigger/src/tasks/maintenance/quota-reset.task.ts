import { schedules, logger } from '@trigger.dev/sdk/v3'

// Runs daily at 00:05 Pacific Time (08:05 UTC)
// YouTube quota resets at midnight Pacific Time
export const quotaResetTask = schedules.task({
  id: 'quota-reset',
  cron: '5 8 * * *', // 08:05 UTC = 00:05 PT (standard time)

  run: async () => {
    logger.info('Running daily YouTube quota reset')

    const { db } = await import('../../lib/db')
    const { youtubeChannels } = await import('../../lib/db/schema')
    const { sql, ne } = await import('drizzle-orm')

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

    logger.info(`YouTube quota reset completed: ${result.length} channels reset`)
    return { channelsReset: result.length }
  },
})
