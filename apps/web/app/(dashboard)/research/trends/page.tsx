'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { TrendingUp, Clock, Zap, Loader2, Hash } from 'lucide-react'

interface Trend {
  title: string
  description: string
  momentum: 'rising' | 'peaked' | 'evergreen'
  velocity: number
  estimatedWeeksUntilPeak: number | null
  contentAngles: string[]
  hashtags: string[]
  targetDemographic: string
  urgencyScore: number
  opportunityWindow: 'days' | 'weeks' | 'months' | 'evergreen'
}

interface TrendData {
  trends?: Trend[]
  insights?: string
  immediateActions?: string[]
  expiresAt?: string
}

interface TrendRecord {
  id: string
  topic: string
  trendData: TrendData | null
  source: string
  discoveredAt: string
  expiresAt: string | null
}

const MOMENTUM_COLOR = {
  rising: 'bg-green-100 text-green-800',
  peaked: 'bg-yellow-100 text-yellow-800',
  evergreen: 'bg-blue-100 text-blue-800',
}

const WINDOW_COLOR = {
  days: 'bg-red-100 text-red-800',
  weeks: 'bg-orange-100 text-orange-800',
  months: 'bg-yellow-100 text-yellow-800',
  evergreen: 'bg-green-100 text-green-800',
}

function UrgencyBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-red-500' : score >= 60 ? 'bg-orange-500' : score >= 40 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Urgency</span>
        <span className="font-bold">{score}/100</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

function TrendCard({ trend }: { trend: Trend }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <h4 className="font-semibold text-sm">{trend.title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{trend.targetDemographic}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MOMENTUM_COLOR[trend.momentum]}`}>
            {trend.momentum}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${WINDOW_COLOR[trend.opportunityWindow]}`}>
            {trend.opportunityWindow}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{trend.description}</p>
      <UrgencyBar score={trend.urgencyScore} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          velocity {trend.velocity}
        </span>
        {trend.estimatedWeeksUntilPeak !== null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            peaks in ~{trend.estimatedWeeksUntilPeak}w
          </span>
        )}
      </div>
      {trend.contentAngles.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Content Angles</p>
          <div className="flex flex-col gap-1">
            {trend.contentAngles.slice(0, 3).map((a) => (
              <p key={a} className="text-xs text-muted-foreground">· {a}</p>
            ))}
          </div>
        </div>
      )}
      {trend.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {trend.hashtags.slice(0, 5).map((h) => (
            <span key={h} className="flex items-center text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
              <Hash className="h-2.5 w-2.5 mr-0.5" />{h}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ResultCard({ record }: { record: TrendRecord }) {
  const trendData = record.trendData
  const trendList = trendData?.trends ?? []
  const hasResults = trendList.length > 0
  const isExpired = record.expiresAt && new Date(record.expiresAt) < new Date()

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              "{record.topic}"
              {isExpired && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-normal">expired</span>}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Discovered {new Date(record.discoveredAt).toLocaleString()}
              {record.expiresAt && ` · expires ${new Date(record.expiresAt).toLocaleDateString()}`}
            </CardDescription>
          </div>
          {hasResults ? (
            <Badge variant="secondary">{trendList.length} trends</Badge>
          ) : (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing...
            </div>
          )}
        </div>
      </CardHeader>
      {hasResults && (
        <CardContent className="pt-0 space-y-4">
          {trendData?.insights && (
            <p className="text-sm text-muted-foreground">{trendData.insights}</p>
          )}
          {trendData?.immediateActions && trendData.immediateActions.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-800">Immediate Actions</p>
              {trendData.immediateActions.map((a) => (
                <p key={a} className="text-xs text-amber-700">· {a}</p>
              ))}
            </div>
          )}
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2">
            {trendList.map((t) => <TrendCard key={t.title} trend={t} />)}
          </div>
        </CardContent>
      )}
      {!hasResults && (
        <CardContent className="pt-0 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      )}
    </Card>
  )
}

export default function TrendsPage() {
  const [topic, setTopic] = useState('')
  const [niche, setNiche] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['research', 'trends', activeOnly],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '20' })
      if (activeOnly) params.set('activeOnly', 'true')
      const res = await fetch(`/api/research/trends?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ results: TrendRecord[] }>
    },
    refetchInterval: (q) => {
      const results = q.state.data?.results ?? []
      const hasActive = results.some((r) => !r.trendData || (r.trendData as TrendData).trends?.length === 0)
      return hasActive ? 5000 : false
    },
  })

  const { mutate: discoverTrends, isPending } = useMutation({
    mutationFn: async (payload: { topic: string; niche?: string }) => {
      const res = await fetch('/api/research/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to start trend discovery')
      }
      return res.json()
    },
    onSuccess: () => {
      setTopic('')
      setNiche('')
      void queryClient.invalidateQueries({ queryKey: ['research', 'trends'] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (topic.trim()) {
      discoverTrends({ topic: topic.trim(), niche: niche.trim() || undefined })
    }
  }

  const results = data?.results ?? []

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Trend Discovery</h1>
        <p className="text-muted-foreground mt-1">
          Identify rising YouTube trends before they peak. Get content angles, hashtags, and opportunity windows.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Topic to discover trends for (e.g. 'AI tools 2025')"
                  className="pl-9"
                  disabled={isPending}
                />
              </div>
              <Input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="Niche (optional)"
                className="w-44"
                disabled={isPending}
              />
              <Button type="submit" disabled={isPending || !topic.trim()}>
                {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Discovering...</> : 'Discover Trends'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="activeOnly"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="activeOnly" className="text-sm text-muted-foreground cursor-pointer">
                Show active (non-expired) trends only
              </label>
            </div>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No trends discovered yet</p>
          <p className="text-sm mt-1">Enter a topic to discover what's trending on YouTube</p>
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((r) => <ResultCard key={r.id} record={r} />)}
        </div>
      )}
    </div>
  )
}
