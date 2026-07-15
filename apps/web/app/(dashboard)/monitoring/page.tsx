'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, DollarSign, Youtube, AlertCircle, CheckCircle2, Clock } from 'lucide-react'

interface QuotaChannel {
  id: string
  channelName: string
  channelHandle: string | null
  channelThumbnail: string | null
  status: string
  quotaUsedToday: number
  quotaLimitDaily: number
}

interface ServiceCost {
  service: string
  costUsd: number
  units: number
  callCount: number
}

interface AuditLog {
  id: string
  action: string
  resourceType: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  disconnected: 'bg-gray-100 text-gray-700',
  quota_exceeded: 'bg-yellow-100 text-yellow-800',
}

const SERVICE_COLOR: Record<string, string> = {
  openai: '#10b981',
  anthropic: '#6366f1',
  elevenlabs: '#f59e0b',
  runway: '#ef4444',
  pika: '#8b5cf6',
  veo: '#4285f4',
  imagen: '#fbbc05',
  cloudinary: '#3b82f6',
  youtube: '#ef4444',
  resend: '#06b6d4',
  stripe: '#635bff',
}

function QuotaBar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min((used / limit) * 100, 100)
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{used.toLocaleString()} used</span>
        <span>{limit.toLocaleString()} limit</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-right text-muted-foreground">{pct.toFixed(1)}%</p>
    </div>
  )
}

export default function MonitoringPage() {
  const { data: quotaData, isLoading: quotaLoading } = useQuery<{
    channels: QuotaChannel[]
    totalUsed: number
    totalLimit: number
  }>({
    queryKey: ['monitoring', 'quota'],
    queryFn: async () => {
      const res = await fetch('/api/monitoring/youtube-quota')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const { data: costData, isLoading: costLoading } = useQuery<{
    services: ServiceCost[]
    totalCost: number
    logs: AuditLog[]
    days: number
  }>({
    queryKey: ['monitoring', 'costs'],
    queryFn: async () => {
      const res = await fetch('/api/monitoring/costs?days=30')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const chartData = (costData?.services ?? []).map((s) => ({
    name: s.service,
    cost: parseFloat(s.costUsd.toFixed(4)),
    calls: s.callCount,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Monitoring</h1>
        <p className="text-muted-foreground">API quota usage, costs, and audit trail</p>
      </div>

      {/* YouTube Quota Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Youtube className="h-4 w-4 text-red-500" />
            YouTube API Quota Today
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {quotaLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (quotaData?.channels ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No channels connected.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {quotaData!.channels.map((ch) => (
                  <div key={ch.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {ch.channelThumbnail ? (
                          <img src={ch.channelThumbnail} alt="" className="h-7 w-7 rounded-full" />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                            {ch.channelName[0]}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium">{ch.channelName}</p>
                          <p className="text-xs text-muted-foreground">{ch.channelHandle}</p>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[ch.status] ?? ''}`}>
                        {ch.status}
                      </span>
                    </div>
                    <QuotaBar used={ch.quotaUsedToday} limit={ch.quotaLimitDaily} />
                  </div>
                ))}
              </div>
              {(quotaData?.channels.length ?? 0) > 1 && (
                <div className="rounded-lg bg-muted/40 p-3 text-sm">
                  <span className="font-medium">Total:</span>{' '}
                  {quotaData!.totalUsed.toLocaleString()} / {quotaData!.totalLimit.toLocaleString()} units
                  ({((quotaData!.totalUsed / quotaData!.totalLimit) * 100).toFixed(1)}%)
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* API Cost Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-green-600" />
              API Costs — Last 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            {costLoading ? (
              <Skeleton className="h-48" />
            ) : chartData.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No API usage recorded yet.
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold mb-4">${costData!.totalCost.toFixed(4)}</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']} />
                    <Bar dataKey="cost" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 divide-y">
                  {costData!.services.map((s) => (
                    <div key={s.service} className="flex items-center justify-between py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: SERVICE_COLOR[s.service] ?? '#94a3b8' }}
                        />
                        <span className="capitalize">{s.service}</span>
                        <span className="text-xs text-muted-foreground">{s.callCount} calls</span>
                      </div>
                      <span className="font-medium">${s.costUsd.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Audit Log */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {costLoading ? (
              <div className="space-y-2">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (costData?.logs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No activity yet.</p>
            ) : (
              <div className="divide-y max-h-96 overflow-y-auto">
                {costData!.logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 py-2.5">
                    <div className="mt-0.5 shrink-0">
                      {log.action.includes('error') || log.action.includes('fail') ? (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                      ) : log.action.includes('connect') || log.action.includes('success') ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{log.action}</p>
                      {log.resourceType && (
                        <p className="text-xs text-muted-foreground">{log.resourceType}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
