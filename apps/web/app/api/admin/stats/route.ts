import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { db } from '@/lib/db'
import { organizations, users, youtubeChannels, videos, organizationMembers, channelAnalytics, apiUsage } from '@/lib/db/schema'
import { isNull, sum, count, sql, gte } from 'drizzle-orm'
import { startOfMonth } from 'date-fns'

export async function GET() {
  const err = await requireAdmin()
  if (err) return err

  const now = new Date()
  const monthStart = startOfMonth(now)

  const [
    [orgStats],
    [userCount],
    [channelCount],
    [videoCount],
    planBreakdown,
    [revenueStats],
    [apiCostMonth],
  ] = await Promise.all([
    db.select({
      total: count(),
      thisMonth: sql<number>`count(*) filter (where created_at >= ${monthStart})`.mapWith(Number),
    }).from(organizations),

    db.select({ count: count() }).from(users),

    db.select({ count: count() })
      .from(youtubeChannels)
      .where(isNull(youtubeChannels.deletedAt)),

    db.select({ count: count() }).from(videos),

    db.select({ plan: organizations.plan, count: count() })
      .from(organizations)
      .groupBy(organizations.plan),

    db.select({
      totalRevenue: sum(channelAnalytics.totalRevenueUsd),
    }).from(channelAnalytics),

    db.select({
      totalCost: sum(apiUsage.costUsd),
    })
      .from(apiUsage)
      .where(gte(apiUsage.recordedAt, monthStart)),
  ])

  return NextResponse.json({
    orgs: { total: orgStats?.total ?? 0, thisMonth: orgStats?.thisMonth ?? 0 },
    users: userCount?.count ?? 0,
    channels: channelCount?.count ?? 0,
    videos: videoCount?.count ?? 0,
    planBreakdown: planBreakdown.map((r) => ({ plan: r.plan, count: r.count })),
    revenueTracked: Number(revenueStats?.totalRevenue ?? 0),
    apiCostThisMonth: Number(apiCostMonth?.totalCost ?? 0),
  })
}
