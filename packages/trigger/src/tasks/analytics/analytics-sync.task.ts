import { schedules, logger } from '@trigger.dev/sdk'
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
    const { eq, isNull, and, inArray } = await import('drizzle-orm')
    const { getValidAccessToken } = await import('../../lib/auth/youtube-oauth')
    const { checkAndDeductQuota } = await import('../../lib/utils/quota')

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

        // Fetch per-video analytics so we can show top-performing videos,
        // not just channel-wide totals (videoAnalytics table existed but
        // nothing ever wrote to it).
        const videoReportUrl = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
        videoReportUrl.searchParams.set('ids', `channel==${channel.ytChannelId}`)
        videoReportUrl.searchParams.set('startDate', startDate)
        videoReportUrl.searchParams.set('endDate', endDate)
        videoReportUrl.searchParams.set(
          'metrics',
          'views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost'
        )
        videoReportUrl.searchParams.set('dimensions', 'video')
        videoReportUrl.searchParams.set('sort', '-views')
        videoReportUrl.searchParams.set('maxResults', '50')

        const videoReport = await fetch(videoReportUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (videoReport.ok) {
          const vdata = (await videoReport.json()) as {
            rows?: Array<[string, number, number, number, number, number, number, number]>
          }
          if (vdata.rows?.length) {
            const ytVideoIds = vdata.rows.map((r) => r[0])
            const ourVideos = await db
              .select({ id: videos.id, ytVideoId: videos.ytVideoId })
              .from(videos)
              .where(inArray(videos.ytVideoId, ytVideoIds))
            const videoIdMap = new Map(ourVideos.map((v) => [v.ytVideoId, v.id]))

            for (const row of vdata.rows) {
              const [ytVideoId, views, watchMin, likes, comments, shares, subsGained, subsLost] = row
              const internalVideoId = videoIdMap.get(ytVideoId)
              if (!internalVideoId) continue // not one of our uploads (or record deleted)

              await db
                .insert(videoAnalytics)
                .values({
                  organizationId: channel.organizationId,
                  channelId: channel.id,
                  videoId: internalVideoId,
                  ytVideoId,
                  snapshotDate: endDate,
                  views: views ?? 0,
                  watchTimeMin: watchMin ?? 0,
                  likes: likes ?? 0,
                  comments: comments ?? 0,
                  shares: shares ?? 0,
                  subscribersGained: subsGained ?? 0,
                  subscribersLost: subsLost ?? 0,
                })
                .onConflictDoUpdate({
                  target: [videoAnalytics.videoId, videoAnalytics.snapshotDate],
                  set: {
                    views: views ?? 0,
                    watchTimeMin: watchMin ?? 0,
                    likes: likes ?? 0,
                    comments: comments ?? 0,
                    shares: shares ?? 0,
                    subscribersGained: subsGained ?? 0,
                    subscribersLost: subsLost ?? 0,
                  },
                })
            }
          }
        }

        // Fast public counters (near-real-time) via the Data API, separate
        // from the Analytics API above which can take 24-72h to reflect a
        // fresh upload.
        const channelVideos = await db
          .select({ id: videos.id, ytVideoId: videos.ytVideoId })
          .from(videos)
          .where(and(eq(videos.channelId, channel.id), isNull(videos.deletedAt)))

        const trackedVideos = channelVideos.filter(
          (v): v is { id: string; ytVideoId: string } => !!v.ytVideoId
        )

        if (trackedVideos.length > 0) {
          const { allowed } = await checkAndDeductQuota(channel.id, 'videos.list')
          if (allowed) {
            const statsUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
            statsUrl.searchParams.set('part', 'statistics')
            statsUrl.searchParams.set('id', trackedVideos.map((v) => v.ytVideoId).join(','))

            const statsRes = await fetch(statsUrl.toString(), {
              headers: { Authorization: `Bearer ${accessToken}` },
            })

            if (statsRes.ok) {
              const statsData = (await statsRes.json()) as {
                items: Array<{ id: string; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }>
              }
              const statsByYtId = new Map(statsData.items.map((item) => [item.id, item.statistics]))

              for (const v of trackedVideos) {
                const stats = statsByYtId.get(v.ytVideoId)
                if (!stats) continue
                await db
                  .update(videos)
                  .set({
                    ytViewCount: stats.viewCount ? parseInt(stats.viewCount) : undefined,
                    ytLikeCount: stats.likeCount ? parseInt(stats.likeCount) : undefined,
                    ytCommentCount: stats.commentCount ? parseInt(stats.commentCount) : undefined,
                    ytStatsSyncedAt: new Date(),
                  })
                  .where(eq(videos.id, v.id))
              }
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
