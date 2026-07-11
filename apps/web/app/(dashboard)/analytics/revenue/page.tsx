'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DollarSign, TrendingUp, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'

interface DailyPoint {
  date: string
  revenueUsd: number
  views: number
}

interface AnalyticsData {
  daily: DailyPoint[]
  totals: { views: number; revenueUsd: number }
  channels: Array<{ id: string; channelName: string; revenueUsd: number; views: number }>
  hasData: boolean
}

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'MMM d') } catch { return d }
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export default function RevenuePage() {
  const [days, setDays] = useState(30)

  const { data, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ['analytics', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics?days=${days}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
  })

  const totals = data?.totals ?? { views: 0, revenueUsd: 0 }
  const chartData = (data?.daily ?? []).map((d) => ({ ...d, date: fmtDate(d.date) }))

  // RPM = revenue / views * 1000
  const rpm = totals.views > 0 ? (totals.revenueUsd / totals.views) * 1000 : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Revenue</h1>
          <p className="text-muted-foreground">Estimated earnings from YouTube monetization</p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-500/10 p-2"><DollarSign className="h-4 w-4 text-green-600" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Revenue</p>
                  <p className="text-xl font-bold">${totals.revenueUsd.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">last {days} days</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2"><TrendingUp className="h-4 w-4 text-blue-600" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">RPM</p>
                  <p className="text-xl font-bold">${rpm.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">per 1K views</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-500/10 p-2"><DollarSign className="h-4 w-4 text-purple-600" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">Daily Avg</p>
                  <p className="text-xl font-bold">${(totals.revenueUsd / Math.max(days, 1)).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">per day</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load revenue data.
        </div>
      )}

      {!isLoading && !isError && !data?.hasData && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <DollarSign className="mx-auto h-12 w-12 text-muted-foreground opacity-40" />
          <h2 className="mt-4 text-lg font-semibold">No revenue data yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Go to Analytics Overview and click Sync Now to fetch data from YouTube.
          </p>
        </div>
      )}

      {!isLoading && data?.hasData && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Revenue Over Time</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, 'Revenue']} />
                  <Area type="monotone" dataKey="revenueUsd" stroke="#10b981" fill="url(#revGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {(data.channels?.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Revenue by Channel</CardTitle></CardHeader>
              <CardContent>
                <div className="divide-y">
                  {data.channels
                    .sort((a, b) => b.revenueUsd - a.revenueUsd)
                    .map((ch) => (
                      <div key={ch.id} className="flex items-center justify-between py-3">
                        <div>
                          <p className="text-sm font-medium">{ch.channelName}</p>
                          <p className="text-xs text-muted-foreground">{fmtNum(ch.views)} views</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">${ch.revenueUsd.toFixed(2)}</p>
                          <p className="text-xs text-muted-foreground">
                            RPM ${ch.views > 0 ? ((ch.revenueUsd / ch.views) * 1000).toFixed(2) : '0.00'}
                          </p>
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
