'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Search, TrendingUp, DollarSign, Users, BarChart2, Loader2 } from 'lucide-react'

interface Niche {
  name: string
  description: string
  estimatedMonthlySearchVolume: number
  competitionLevel: 'low' | 'medium' | 'high'
  monetizationPotential: 'low' | 'medium' | 'high'
  averageCpm: number
  contentFormats: string[]
  keyTopics: string[]
  targetAudience: string
  growthTrend: 'declining' | 'stable' | 'growing' | 'exploding'
  entryBarrier: 'low' | 'medium' | 'high'
  score: number
}

interface NicheResult {
  id: string
  query: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  niches: { niches?: Niche[]; summary?: string; recommendedNiche?: string; reasoning?: string } | null
  modelUsed: string
  tokensUsed: number | null
  errorMessage: string | null
  createdAt: string
}

const LEVEL_COLOR = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
}

const TREND_COLOR = {
  exploding: 'bg-purple-100 text-purple-800',
  growing: 'bg-green-100 text-green-800',
  stable: 'bg-blue-100 text-blue-800',
  declining: 'bg-gray-100 text-gray-700',
}

const STATUS_COLOR = {
  pending: 'bg-yellow-100 text-yellow-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

function NicheCard({ niche }: { niche: Niche }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-sm">{niche.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{niche.targetAudience}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-bold text-primary">{niche.score}/100</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TREND_COLOR[niche.growthTrend]}`}>
            {niche.growthTrend}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{niche.description}</p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex items-center gap-1">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className={`px-1.5 py-0.5 rounded-full font-medium ${LEVEL_COLOR[niche.competitionLevel]}`}>
            {niche.competitionLevel} comp
          </span>
        </div>
        <div className="flex items-center gap-1">
          <DollarSign className="h-3 w-3 text-muted-foreground" />
          <span className={`px-1.5 py-0.5 rounded-full font-medium ${LEVEL_COLOR[niche.monetizationPotential]}`}>
            ${niche.averageCpm} CPM
          </span>
        </div>
        <div className="flex items-center gap-1">
          <BarChart2 className="h-3 w-3 text-muted-foreground" />
          <span className={`px-1.5 py-0.5 rounded-full font-medium ${LEVEL_COLOR[niche.entryBarrier]}`}>
            {niche.entryBarrier} entry
          </span>
        </div>
      </div>
      {niche.contentFormats.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {niche.contentFormats.slice(0, 4).map((f) => (
            <span key={f} className="text-xs bg-muted px-1.5 py-0.5 rounded">{f}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function ResultCard({ result }: { result: NicheResult }) {
  const [expanded, setExpanded] = useState(false)
  const nicheData = result.niches
  const nicheList = nicheData?.niches ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">"{result.query}"</CardTitle>
            <CardDescription className="text-xs mt-1">
              {new Date(result.createdAt).toLocaleString()} · {result.modelUsed}
              {result.tokensUsed ? ` · ${result.tokensUsed.toLocaleString()} tokens` : ''}
            </CardDescription>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_COLOR[result.status]}`}>
            {result.status === 'running' && <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />}
            {result.status}
          </span>
        </div>
      </CardHeader>

      {result.status === 'completed' && nicheData && (
        <CardContent className="pt-0 space-y-3">
          {nicheData.summary && (
            <p className="text-sm text-muted-foreground">{nicheData.summary}</p>
          )}
          {nicheData.recommendedNiche && (
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="font-medium">Recommended:</span>
              <span className="text-green-700">{nicheData.recommendedNiche}</span>
            </div>
          )}
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{nicheList.length} niches analyzed</span>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : 'Show all niches'}
            </Button>
          </div>
          {expanded && (
            <div className="grid gap-3 sm:grid-cols-2">
              {nicheList.map((n) => <NicheCard key={n.name} niche={n} />)}
            </div>
          )}
          {!expanded && nicheList.length > 0 && nicheList[0] && (
            <NicheCard niche={nicheList[0]} />
          )}
        </CardContent>
      )}
      {result.status === 'failed' && result.errorMessage && (
        <CardContent className="pt-0">
          <p className="text-sm text-destructive">{result.errorMessage}</p>
        </CardContent>
      )}
      {(result.status === 'pending' || result.status === 'running') && (
        <CardContent className="pt-0 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      )}
    </Card>
  )
}

export default function NicheResearchPage() {
  const [query, setQuery] = useState('')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['research', 'niches'],
    queryFn: async () => {
      const res = await fetch('/api/research/niches?limit=20')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ results: NicheResult[] }>
    },
    refetchInterval: (q) => {
      const results = q.state.data?.results ?? []
      const hasActive = results.some((r) => r.status === 'pending' || r.status === 'running')
      return hasActive ? 5000 : false
    },
  })

  const { mutate: runResearch, isPending } = useMutation({
    mutationFn: async (q: string) => {
      const res = await fetch('/api/research/niches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to start research')
      }
      return res.json()
    },
    onSuccess: () => {
      setQuery('')
      void queryClient.invalidateQueries({ queryKey: ['research', 'niches'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to start research')
      void queryClient.invalidateQueries({ queryKey: ['research', 'niches'] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim().length >= 2) runResearch(query.trim())
  }

  const results = data?.results ?? []

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Niche Research</h1>
        <p className="text-muted-foreground mt-1">
          Discover profitable YouTube niches with AI-powered analysis of competition, monetization potential, and growth trends.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter a topic to research (e.g. 'personal finance for millennials')"
                className="pl-9"
                disabled={isPending}
              />
            </div>
            <Button type="submit" disabled={isPending || query.trim().length < 2}>
              {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing...</> : 'Analyze Niches'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No research yet</p>
          <p className="text-sm mt-1">Enter a topic above to discover profitable YouTube niches</p>
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((result) => <ResultCard key={result.id} result={result} />)}
        </div>
      )}
    </div>
  )
}
