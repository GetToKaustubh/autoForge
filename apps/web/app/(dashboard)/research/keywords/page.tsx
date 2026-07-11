'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, Loader2, ArrowUpRight, TrendingUp } from 'lucide-react'

interface Keyword {
  keyword: string
  searchVolume: 'low' | 'medium' | 'high' | 'very_high'
  competition: 'low' | 'medium' | 'high'
  cpc: number
  intent: 'informational' | 'commercial' | 'navigational' | 'transactional'
  type: 'short_tail' | 'long_tail' | 'question' | 'comparison'
  difficulty: number
  opportunity: number
  relatedKeywords: string[]
  videoAngle: string
}

interface Cluster {
  theme: string
  keywords: string[]
  contentStrategy: string
}

interface KeywordResults {
  keywords?: Keyword[]
  clusters?: Cluster[]
  topOpportunity?: string
  contentGaps?: string[]
}

interface KeywordRecord {
  id: string
  seedKeyword: string
  results: KeywordResults | null
  source: string
  createdAt: string
}

const VOLUME_COLOR = {
  very_high: 'bg-purple-100 text-purple-800',
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-700',
}

const COMP_COLOR = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
}

function ScoreBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function KeywordRow({ kw }: { kw: Keyword }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border rounded-lg p-3 space-y-2 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{kw.keyword}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{kw.videoAngle}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${VOLUME_COLOR[kw.searchVolume]}`}>
            {kw.searchVolume.replace('_', ' ')}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${COMP_COLOR[kw.competition]}`}>
            {kw.competition}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ScoreBar value={kw.opportunity} label="Opportunity" color="bg-green-500" />
        <ScoreBar value={kw.difficulty} label="Difficulty" color="bg-red-400" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{kw.type.replace('_', ' ')}</span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">{kw.intent}</span>
        {kw.cpc > 0 && (
          <>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">${kw.cpc.toFixed(2)} CPC</span>
          </>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-auto text-xs text-primary hover:underline"
        >
          {expanded ? 'less' : 'more'}
        </button>
      </div>
      {expanded && kw.relatedKeywords.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {kw.relatedKeywords.map((r) => (
            <span key={r} className="text-xs bg-muted px-1.5 py-0.5 rounded">{r}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function ResultCard({ record }: { record: KeywordRecord }) {
  const results = record.results
  const keywords = results?.keywords ?? []
  const hasResults = keywords.length > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">"{record.seedKeyword}"</CardTitle>
            <CardDescription className="text-xs mt-1">
              {new Date(record.createdAt).toLocaleString()} · {record.source}
            </CardDescription>
          </div>
          {hasResults ? (
            <Badge variant="secondary">{keywords.length} keywords</Badge>
          ) : (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Processing...
            </div>
          )}
        </div>
      </CardHeader>
      {hasResults && (
        <CardContent className="pt-0 space-y-4">
          {results?.topOpportunity && (
            <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3">
              <ArrowUpRight className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-green-800">Top Opportunity</p>
                <p className="text-xs text-green-700 mt-0.5">{results.topOpportunity}</p>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {keywords.slice(0, 10).map((kw) => <KeywordRow key={kw.keyword} kw={kw} />)}
            {keywords.length > 10 && (
              <p className="text-xs text-center text-muted-foreground">
                +{keywords.length - 10} more keywords
              </p>
            )}
          </div>
          {results?.clusters && results.clusters.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Keyword Clusters</p>
              {results.clusters.map((c) => (
                <div key={c.theme} className="rounded-lg border p-3 space-y-1">
                  <p className="text-sm font-medium">{c.theme}</p>
                  <p className="text-xs text-muted-foreground">{c.contentStrategy}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.keywords.map((k) => (
                      <span key={k} className="text-xs bg-muted px-1.5 py-0.5 rounded">{k}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
      {!hasResults && (
        <CardContent className="pt-0 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      )}
    </Card>
  )
}

export default function KeywordResearchPage() {
  const [seedKeyword, setSeedKeyword] = useState('')
  const [niche, setNiche] = useState('')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['research', 'keywords'],
    queryFn: async () => {
      const res = await fetch('/api/research/keywords?limit=20')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ results: KeywordRecord[] }>
    },
    refetchInterval: (q) => {
      const results = q.state.data?.results ?? []
      const hasActive = results.some((r) => !r.results || (r.results as KeywordResults).keywords?.length === 0)
      return hasActive ? 5000 : false
    },
  })

  const { mutate: runResearch, isPending } = useMutation({
    mutationFn: async (payload: { seedKeyword: string; niche?: string }) => {
      const res = await fetch('/api/research/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to start research')
      }
      return res.json()
    },
    onSuccess: () => {
      setSeedKeyword('')
      setNiche('')
      void queryClient.invalidateQueries({ queryKey: ['research', 'keywords'] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (seedKeyword.trim()) {
      runResearch({ seedKeyword: seedKeyword.trim(), niche: niche.trim() || undefined })
    }
  }

  const results = data?.results ?? []

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Keyword Research</h1>
        <p className="text-muted-foreground mt-1">
          Find high-opportunity YouTube keywords with AI-powered search volume, competition, and content angle analysis.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={seedKeyword}
                  onChange={(e) => setSeedKeyword(e.target.value)}
                  placeholder="Seed keyword (e.g. 'passive income')"
                  className="pl-9"
                  disabled={isPending}
                />
              </div>
              <Input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="Niche (optional)"
                className="w-48"
                disabled={isPending}
              />
              <Button type="submit" disabled={isPending || !seedKeyword.trim()}>
                {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Researching...</> : 'Research'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No keyword research yet</p>
          <p className="text-sm mt-1">Enter a seed keyword to find YouTube search opportunities</p>
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((r) => <ResultCard key={r.id} record={r} />)}
        </div>
      )}
    </div>
  )
}
