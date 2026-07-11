import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, Users, Youtube, Video, DollarSign, TrendingUp } from 'lucide-react'
import { db } from '@/lib/db'
import { organizations, users, youtubeChannels, videos, channelAnalytics, apiUsage } from '@/lib/db/schema'
import { isNull, sum, count, sql } from 'drizzle-orm'
import { startOfMonth } from 'date-fns'

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  starter: 'bg-blue-100 text-blue-800',
  pro: 'bg-purple-100 text-purple-800',
  agency: 'bg-amber-100 text-amber-800',
  enterprise: 'bg-green-100 text-green-800',
}

export default async function AdminOverviewPage() {
  const monthStart = startOfMonth(new Date())

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
    db.select({ count: count() }).from(youtubeChannels).where(isNull(youtubeChannels.deletedAt)),
    db.select({ count: count() }).from(videos),
    db.select({ plan: organizations.plan, count: count() }).from(organizations).groupBy(organizations.plan),
    db.select({ totalRevenue: sum(channelAnalytics.totalRevenueUsd) }).from(channelAnalytics),
    db.select({ totalCost: sum(apiUsage.costUsd) }).from(apiUsage).where(sql`recorded_at >= ${monthStart}`),
  ])

  const statCards = [
    { label: 'Total Organizations', value: orgStats?.total ?? 0, sub: `+${orgStats?.thisMonth ?? 0} this month`, icon: Building2 },
    { label: 'Total Users', value: userCount?.count ?? 0, sub: 'across all orgs', icon: Users },
    { label: 'YouTube Channels', value: channelCount?.count ?? 0, sub: 'connected & active', icon: Youtube },
    { label: 'Videos Created', value: videoCount?.count ?? 0, sub: 'all time', icon: Video },
    { label: 'Revenue Tracked', value: `$${Number(revenueStats?.totalRevenue ?? 0).toFixed(2)}`, sub: 'YouTube earnings synced', icon: DollarSign },
    { label: 'API Cost This Month', value: `$${Number(apiCostMonth?.totalCost ?? 0).toFixed(2)}`, sub: 'across all orgs', icon: TrendingUp },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Overview</h1>
        <p className="text-muted-foreground text-sm">Real-time stats across all organizations</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
              <p className="text-xs text-muted-foreground mt-1">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organizations by Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {planBreakdown.map(({ plan, count: c }) => (
              <div key={plan} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${PLAN_COLOR[plan] ?? 'bg-muted'}`}>
                <span className="capitalize">{plan}</span>
                <span className="font-bold">{c}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
