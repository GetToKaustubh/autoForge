import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channelAnalytics, youtubeChannels } from '@/lib/db/schema'
import { and, eq, gte, isNull } from 'drizzle-orm'
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

  return NextResponse.json({ daily, totals, channels: channelBreakdown, days, hasData: rows.length > 0 })
}
