import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { youtubeChannels, channelAnalytics, videoAnalytics, videos } from '@/lib/db/schema'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember } from '@/lib/auth/get-member'
import { getValidAccessToken } from '@/lib/auth/youtube-oauth'
import { checkAndDeductQuota } from '@/lib/utils/quota'
import { subDays, format } from 'date-fns'

export async function POST() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const channels = await db
    .select({ id: youtubeChannels.id, ytChannelId: youtubeChannels.ytChannelId })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.organizationId, member.orgDbId), eq(youtubeChannels.status, 'active'), isNull(youtubeChannels.deletedAt)))

  if (channels.length === 0) return NextResponse.json({ synced: 0 })

  const endDate = format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  let synced = 0
  const errors: string[] = []

  for (const channel of channels) {
    try {
      const accessToken = await getValidAccessToken(channel.id)

      const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
      url.searchParams.set('ids', `channel==${channel.ytChannelId}`)
      url.searchParams.set('startDate', startDate)
      url.searchParams.set('endDate', endDate)
      url.searchParams.set('metrics', 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,estimatedRevenue')
      url.searchParams.set('dimensions', 'day')

      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })

      if (res.ok) {
        const data = await res.json() as { rows?: Array<[string, number, number, number, number, number]> }
        if (data.rows) {
          for (const row of data.rows) {
            const [day, views, watchMin, subsGained, subsLost, revenue] = row
            if (!day) continue
            await db
              .insert(channelAnalytics)
              .values({
                organizationId: member.orgDbId,
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
        // Per-video breakdown (videoAnalytics table existed but nothing wrote to it)
        const videoUrl = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
        videoUrl.searchParams.set('ids', `channel==${channel.ytChannelId}`)
        videoUrl.searchParams.set('startDate', startDate)
        videoUrl.searchParams.set('endDate', endDate)
        videoUrl.searchParams.set(
          'metrics',
          'views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost'
        )
        videoUrl.searchParams.set('dimensions', 'video')
        videoUrl.searchParams.set('sort', '-views')
        videoUrl.searchParams.set('maxResults', '50')

        const videoRes = await fetch(videoUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
        if (videoRes.ok) {
          const vdata = await videoRes.json() as {
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
              const [ytVideoId, vViews, vWatchMin, likes, comments, shares, vSubsGained, vSubsLost] = row
              const internalVideoId = videoIdMap.get(ytVideoId)
              if (!internalVideoId) continue

              await db
                .insert(videoAnalytics)
                .values({
                  organizationId: member.orgDbId,
                  channelId: channel.id,
                  videoId: internalVideoId,
                  ytVideoId,
                  snapshotDate: endDate,
                  views: vViews ?? 0,
                  watchTimeMin: vWatchMin ?? 0,
                  likes: likes ?? 0,
                  comments: comments ?? 0,
                  shares: shares ?? 0,
                  subscribersGained: vSubsGained ?? 0,
                  subscribersLost: vSubsLost ?? 0,
                })
                .onConflictDoUpdate({
                  target: [videoAnalytics.videoId, videoAnalytics.snapshotDate],
                  set: {
                    views: vViews ?? 0,
                    watchTimeMin: vWatchMin ?? 0,
                    likes: likes ?? 0,
                    comments: comments ?? 0,
                    shares: shares ?? 0,
                    subscribersGained: vSubsGained ?? 0,
                    subscribersLost: vSubsLost ?? 0,
                  },
                })
            }
          }
        }

        // Fast public counters (near-real-time) via the Data API, separate
        // from the Analytics API above which can take 24-72h to reflect a
        // fresh upload — this is what shows up on the video's public page
        // right away and is what "0 views but YouTube shows 1" was missing.
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
      } else {
        const errBody = await res.text()
        errors.push(`${channel.id}: ${res.status} ${errBody.slice(0, 100)}`)
      }
    } catch (err) {
      errors.push(`${channel.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({ synced, errors, total: channels.length })
}
