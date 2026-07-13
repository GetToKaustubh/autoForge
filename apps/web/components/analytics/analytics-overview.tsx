'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Eye, Clock, Users, DollarSign, RefreshCw, TrendingUp, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'

interface DailyPoint {
  date: string
  views: number
  watchTimeMin: number
  subscriberChange: number
  revenueUsd: number
}

interface ChannelBreakdown {
  id: string
  channelName: string
  ytChannelId: string
  views: number
  watchTimeMin: number
  revenueUsd: number
}

interface TopVideo {
  videoId: string
  title: string
  ytUrl: string | null
  views: number
  watchTimeMin: number
  likes: number
  comments: number
}

interface AnalyticsData {
  daily: DailyPoint[]
  totals: { views: number; watchTimeMin: number; subscriberChange: number; revenueUsd: number }
  channels: ChannelBreakdown[]
  topVideos: TopVideo[]
  days: number
  hasData: boolean
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function fmtHours(min: number) {
  if (min >= 60) return `${(min / 60).toFixed(0)}h`
  return `${min}m`
}

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'MMM d') } catch { return d }
}

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444']

export function AnalyticsOverview({ days: defaultDays = 30 }: { days?: number }) {
  const [days, setDays] = useState(defaultDays)
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ['analytics', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics?days=${days}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
  })

  const { mutate: sync, isPending: syncing } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/analytics/sync', { method: 'POST' })
      if (!res.ok) throw new Error('Sync failed')
      return res.json() as Promise<{ synced: number; errors: string[] }>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['analytics'] })
    },
  })

  const totals = data?.totals ?? { views: 0, watchTimeMin: 0, subscriberChange: 0, revenueUsd: 0 }
  const daily = data?.daily ?? []
  const chartData = daily.map((d) => ({ ...d, date: fmtDate(d.date) }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">Channel performance across all connected channels</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => sync()} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Eye} label="Total Views" value={fmtNum(totals.views)} sub={`last ${days} days`} />
          <StatCard icon={Clock} label="Watch Time" value={fmtHours(totals.watchTimeMin)} sub="minutes watched" />
          <StatCard
            icon={Users}
            label="Subscriber Change"
            value={`${totals.subscriberChange >= 0 ? '+' : ''}${fmtNum(totals.subscriberChange)}`}
            sub={`last ${days} days`}
          />
          <StatCard icon={DollarSign} label="Est. Revenue" value={`$${totals.revenueUsd.toFixed(2)}`} sub="USD (estimated)" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && !data?.hasData && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <TrendingUp className="mx-auto h-12 w-12 text-muted-foreground opacity-40" />
          <h2 className="mt-4 text-lg font-semibold">No analytics data yet</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
            Analytics sync runs daily at 06:00 UTC. Click Sync Now to fetch data immediately.
          </p>
          <Button className="mt-4" onClick={() => sync()} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load analytics data.
        </div>
      )}

      {/* Views Chart */}
      {!isLoading && data?.hasData && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Views Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={fmtNum} />
                  <Tooltip formatter={(v: number) => [fmtNum(v), 'Views']} />
                  <Line type="monotone" dataKey="views" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Channel Breakdown */}
          {(data.channels?.length ?? 0) > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Views by Channel</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.channels} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={fmtNum} />
                    <YAxis type="category" dataKey="channelName" tick={{ fontSize: 12 }} width={120} />
                    <Tooltip formatter={(v: number) => [fmtNum(v), 'Views']} />
                    <Bar dataKey="views" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Top Videos */}
          {(data.topVideos?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Videos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {data.topVideos.map((v) => (
                    <div key={v.videoId} className="flex items-center justify-between py-3 gap-4">
                      <div className="min-w-0">
                        {v.ytUrl ? (
                          <a
                            href={v.ytUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium truncate block hover:underline"
                          >
                            {v.title}
                          </a>
                        ) : (
                          <p className="text-sm font-medium truncate">{v.title}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {fmtNum(v.likes)} likes · {fmtNum(v.comments)} comments
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{fmtNum(v.views)} views</p>
                        <p className="text-xs text-muted-foreground">{fmtHours(v.watchTimeMin)} watched</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
