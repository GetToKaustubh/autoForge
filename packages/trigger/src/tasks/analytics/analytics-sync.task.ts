import { schedules, logger } from '@trigger.dev/sdk/v3'
import { subDays, format } from 'date-fns'

// Syncs analytics for all active channels daily at 06:00 UTC
export const analyticsSyncTask = schedules.task({
  id: 'analytics-sync',
  cron: '0 6 * * *',
  maxDuration: 600,

  run: async () => {
    logger.info('Starting daily analytics sync')

    const { db } = await import('../../lib/db')
    const { youtubeChannels, organizations, videoAnalytics, channelAnalytics, videos } =
      await import('../../lib/db/schema')
    const { eq, isNull, and } = await import('drizzle-orm')
    const { getValidAccessToken } = await import('../../lib/auth/youtube-oauth')

    const activeChannels = await db
      .select({
        id: youtubeChannels.id,
        ytChannelId: youtubeChannels.ytChannelId,
        organizationId: youtubeChannels.organizationId,
      })
      .from(youtubeChannels)
      .where(and(eq(youtubeChannels.status, 'active'), isNull(youtubeChannels.deletedAt)))

    let synced = 0
    const errors: string[] = []

    for (const channel of activeChannels) {
      try {
        const accessToken = await getValidAccessToken(channel.id)
        const endDate = format(new Date(), 'yyyy-MM-dd')
        const startDate = format(subDays(new Date(), 7), 'yyyy-MM-dd')

        // Fetch channel-level analytics
        const channelReportUrl = new URL(
          'https://youtubeanalytics.googleapis.com/v2/reports'
        )
        channelReportUrl.searchParams.set('ids', `channel==${channel.ytChannelId}`)
        channelReportUrl.searchParams.set('startDate', startDate)
        channelReportUrl.searchParams.set('endDate', endDate)
        channelReportUrl.searchParams.set(
          'metrics',
          'views,estimatedMinutesWatched,subscribersGained,subscribersLost,estimatedRevenue,averageViewDuration'
        )
        channelReportUrl.searchParams.set('dimensions', 'day')

        const channelReport = await fetch(channelReportUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (channelReport.ok) {
          const data = await channelReport.json() as {
            rows?: Array<[string, number, number, number, number, number, number]>
          }
          if (data.rows) {
            for (const row of data.rows) {
              const [day, views, watchMin, subsGained, subsLost, revenue] = row
              if (!day) continue
              await db
                .insert(channelAnalytics)
                .values({
                  organizationId: channel.organizationId,
                  channelId: channel.id,
                  snapshotDate: day,
                  totalViews: views ?? 0,
                  totalWatchTimeMin: watchMin ?? 0,
                  subscriberChange: (subsGained ?? 0) - (subsLost ?? 0),
                  totalRevenueUsd: (revenue ?? 0).toString(),
                })
                .onConflictDoUpdate({
                  target: [channelAnalytics.channelId, channelAnalytics.snapshotDate],
                  set: {
                    totalViews: views ?? 0,
                    totalWatchTimeMin: watchMin ?? 0,
                    subscriberChange: (subsGained ?? 0) - (subsLost ?? 0),
                    totalRevenueUsd: (revenue ?? 0).toString(),
                  },
                })
            }
          }
        }

        synced++
      } catch (error) {
        logger.error(`Analytics sync failed for channel ${channel.id}: ${String(error)}`)
        errors.push(channel.id)
      }
    }

    logger.info(`Analytics sync completed: ${synced} synced, ${errors.length} errors`)
    return { synced, errors }
  },
})
