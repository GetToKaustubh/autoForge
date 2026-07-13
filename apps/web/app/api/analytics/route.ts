import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channelAnalytics, youtubeChannels, videoAnalytics, videos } from '@/lib/db/schema'
import { and, eq, gte, isNull, isNotNull, sql } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember } from '@/lib/auth/get-member'
import { subDays, format } from 'date-fns'

export async function GET(request: Request) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '30'), 90)
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd')

  const channels = await db
    .select({ id: youtubeChannels.id, channelName: youtubeChannels.channelName, ytChannelId: youtubeChannels.ytChannelId })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.organizationId, member.orgDbId), isNull(youtubeChannels.deletedAt)))

  const rows = await db
    .select({
      channelId: channelAnalytics.channelId,
      snapshotDate: channelAnalytics.snapshotDate,
      totalViews: channelAnalytics.totalViews,
      totalWatchTimeMin: channelAnalytics.totalWatchTimeMin,
      subscriberChange: channelAnalytics.subscriberChange,
      totalRevenueUsd: channelAnalytics.totalRevenueUsd,
      avgCtr: channelAnalytics.avgCtr,
    })
    .from(channelAnalytics)
    .where(and(eq(channelAnalytics.organizationId, member.orgDbId), gte(channelAnalytics.snapshotDate, startDate)))
    .orderBy(channelAnalytics.snapshotDate)

  // Aggregate by date across all channels
  const byDate = new Map<string, { date: string; views: number; watchTimeMin: number; subscriberChange: number; revenueUsd: number }>()
  for (const row of rows) {
    const d = row.snapshotDate
    const prev = byDate.get(d) ?? { date: d, views: 0, watchTimeMin: 0, subscriberChange: 0, revenueUsd: 0 }
    prev.views += row.totalViews ?? 0
    prev.watchTimeMin += row.totalWatchTimeMin ?? 0
    prev.subscriberChange += row.subscriberChange ?? 0
    prev.revenueUsd += parseFloat(row.totalRevenueUsd ?? '0')
    byDate.set(d, prev)
  }

  // Per-channel breakdown
  const byChannel = new Map<string, { channelId: string; views: number; watchTimeMin: number; revenueUsd: number }>()
  for (const row of rows) {
    const prev = byChannel.get(row.channelId) ?? { channelId: row.channelId, views: 0, watchTimeMin: 0, revenueUsd: 0 }
    prev.views += row.totalViews ?? 0
    prev.watchTimeMin += row.totalWatchTimeMin ?? 0
    prev.revenueUsd += parseFloat(row.totalRevenueUsd ?? '0')
    byChannel.set(row.channelId, prev)
  }

  const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  const totals = daily.reduce(
    (acc, d) => ({
      views: acc.views + d.views,
      watchTimeMin: acc.watchTimeMin + d.watchTimeMin,
      subscriberChange: acc.subscriberChange + d.subscriberChange,
      revenueUsd: +(acc.revenueUsd + d.revenueUsd).toFixed(4),
    }),
    { views: 0, watchTimeMin: 0, subscriberChange: 0, revenueUsd: 0 }
  )

  const channelBreakdown = channels.map((ch) => ({
    ...ch,
    ...(byChannel.get(ch.id) ?? { views: 0, watchTimeMin: 0, revenueUsd: 0 }),
  }))

  // Prefer the fast public counters (videos.ytViewCount, synced via the
  // Data API - near-real-time) over the Analytics API rollup (video_analytics,
  // which can take 24-72h to reflect a fresh upload). Watch time/likes/comments
  // still come from the Analytics side once it catches up.
  const topVideosRaw = await db
    .select({
      videoId: videos.id,
      channelId: videos.channelId,
      title: videos.title,
      ytUrl: videos.ytUrl,
      ytViewCount: videos.ytViewCount,
      ytLikeCount: videos.ytLikeCount,
      ytCommentCount: videos.ytCommentCount,
      analyticsViews: sql<number>`coalesce(sum(${videoAnalytics.views}), 0)`,
      watchTimeMin: sql<number>`coalesce(sum(${videoAnalytics.watchTimeMin}), 0)`,
      analyticsLikes: sql<number>`coalesce(sum(${videoAnalytics.likes}), 0)`,
      analyticsComments: sql<number>`coalesce(sum(${videoAnalytics.comments}), 0)`,
    })
    .from(videos)
    .leftJoin(
      videoAnalytics,
      and(eq(videoAnalytics.videoId, videos.id), gte(videoAnalytics.snapshotDate, startDate))
    )
    .where(and(eq(videos.organizationId, member.orgDbId), isNotNull(videos.ytVideoId)))
    .groupBy(videos.id, videos.channelId, videos.title, videos.ytUrl, videos.ytViewCount, videos.ytLikeCount, videos.ytCommentCount)
    .orderBy(
      sql`greatest(coalesce(${videos.ytViewCount}, 0), coalesce(sum(${videoAnalytics.views}), 0)) desc`
    )

  const fastViewsByVideo = topVideosRaw.map((v) => ({
    ...v,
    views: Math.max(v.ytViewCount ?? 0, v.analyticsViews),
    likes: Math.max(v.ytLikeCount ?? 0, v.analyticsLikes),
    comments: Math.max(v.ytCommentCount ?? 0, v.analyticsComments),
  }))

  const topVideos = fastViewsByVideo.slice(0, 10).map((v) => ({
    videoId: v.videoId,
    title: v.title,
    ytUrl: v.ytUrl,
    views: v.views,
    watchTimeMin: v.watchTimeMin,
    likes: v.likes,
    comments: v.comments,
  }))

  // The fast per-video counter (videos.ytViewCount) and the Analytics API
  // rollup (channelAnalytics/daily) are two different data sources with
  // different latency - without reconciling them, Total Views/Views by
  // Channel could show 0 while Top Videos (which already takes the max of
  // both) shows real numbers for the same data.
  const fastViewsTotal = fastViewsByVideo.reduce((sum, v) => sum + v.views, 0)
  const fastViewsByChannel = new Map<string, number>()
  for (const v of fastViewsByVideo) {
    fastViewsByChannel.set(v.channelId, (fastViewsByChannel.get(v.channelId) ?? 0) + v.views)
  }

  totals.views = Math.max(totals.views, fastViewsTotal)

  for (const ch of channelBreakdown) {
    ch.views = Math.max(ch.views, fastViewsByChannel.get(ch.id) ?? 0)
  }

  if (daily.length === 0 && fastViewsTotal > 0) {
    daily.push({
      date: format(new Date(), 'yyyy-MM-dd'),
      views: fastViewsTotal,
      watchTimeMin: 0,
      subscriberChange: 0,
      revenueUsd: 0,
    })
  }

  return NextResponse.json({
    daily,
    totals,
    channels: channelBreakdown,
    topVideos,
    days,
    hasData: rows.length > 0 || topVideos.length > 0,
  })
}
