'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Lightbulb, Plus, Wand2, Loader2, CheckCircle, Clock, Rocket, Archive } from 'lucide-react'
import { useActiveChannel } from '@/hooks/use-channel'

type IdeaStatus = 'idea' | 'approved' | 'in_production' | 'published' | 'rejected' | 'archived'
type VideoFormat = 'tutorial' | 'review' | 'listicle' | 'vlog' | 'documentary' | 'shorts' | 'live' | 'comparison'

interface VideoIdea {
  id: string
  title: string
  hook: string | null
  description: string | null
  format: VideoFormat | null
  targetKeywords: string[] | null
  priority: number
  status: IdeaStatus
  estimatedViewsMin: number | null
  estimatedViewsMax: number | null
  createdAt: string
}

const COLUMNS: { status: IdeaStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { status: 'idea', label: 'Ideas', icon: <Lightbulb className="h-4 w-4" />, color: 'border-yellow-200 bg-yellow-50/50' },
  { status: 'approved', label: 'Approved', icon: <CheckCircle className="h-4 w-4" />, color: 'border-green-200 bg-green-50/50' },
  { status: 'in_production', label: 'In Production', icon: <Rocket className="h-4 w-4" />, color: 'border-blue-200 bg-blue-50/50' },
  { status: 'published', label: 'Published', icon: <Archive className="h-4 w-4" />, color: 'border-gray-200 bg-gray-50/50' },
]

const FORMAT_LABELS: Record<VideoFormat, string> = {
  tutorial: 'Tutorial', review: 'Review', listicle: 'List', vlog: 'Vlog',
  documentary: 'Doc', shorts: 'Shorts', live: 'Live', comparison: 'Comparison',
}

function IdeaCard({ idea, onStatusChange }: { idea: VideoIdea; onStatusChange: (id: string, status: IdeaStatus) => void }) {
  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm hover:shadow-md transition-shadow space-y-2">
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm font-medium leading-tight line-clamp-2">{idea.title}</p>
        <span className="text-xs text-muted-foreground shrink-0 font-bold">{idea.priority}/10</span>
      </div>
      {idea.hook && <p className="text-xs text-muted-foreground line-clamp-1 italic">"{idea.hook}"</p>}
      <div className="flex items-center gap-1.5 flex-wrap">
        {idea.format && (
          <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{FORMAT_LABELS[idea.format]}</span>
        )}
        {idea.estimatedViewsMin != null && idea.estimatedViewsMax != null && (
          <span className="text-xs text-muted-foreground">
            {(idea.estimatedViewsMin / 1000).toFixed(0)}K–{(idea.estimatedViewsMax / 1000).toFixed(0)}K views
          </span>
        )}
      </div>
      {idea.status === 'idea' && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs"
          onClick={() => onStatusChange(idea.id, 'approved')}
        >
          Approve
        </Button>
      )}
      {idea.status === 'approved' && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs"
          onClick={() => onStatusChange(idea.id, 'in_production')}
        >
          Start Production
        </Button>
      )}
    </div>
  )
}

function CreateIdeaDialog({ open, onClose, channelId }: { open: boolean; onClose: () => void; channelId: string }) {
  const [title, setTitle] = useState('')
  const [hook, setHook] = useState('')
  const [format, setFormat] = useState<VideoFormat | ''>('')
  const [niche, setNiche] = useState('')
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const [selectedTrends, setSelectedTrends] = useState<string[]>([])
  const [customKeyword, setCustomKeyword] = useState('')
  const [customTrend, setCustomTrend] = useState('')
  const queryClient = useQueryClient()

  const { data: keywordData } = useQuery({
    queryKey: ['keywords-for-idea', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/research/keywords?limit=5`)
      if (!res.ok) throw new Error('Failed to fetch keywords')
      return res.json() as Promise<{ results: { results: { keywords?: { keyword: string }[] } | null }[] }>
    },
    enabled: open,
  })
  const availableKeywords = Array.from(new Set(
    (keywordData?.results ?? []).flatMap((r) => (r.results?.keywords ?? []).map((k) => k.keyword)),
  )).slice(0, 30)

  const { data: trendData } = useQuery({
    queryKey: ['trends-for-idea', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/research/trends?limit=5`)
      if (!res.ok) throw new Error('Failed to fetch trends')
      return res.json() as Promise<{ results: { trendData: { trends?: { title: string }[] } | null }[] }>
    },
    enabled: open,
  })
  const availableTrends = Array.from(new Set(
    (trendData?.results ?? []).flatMap((r) => (r.trendData?.trends ?? []).map((t) => t.title)),
  )).slice(0, 20)

  const toggleKeyword = (kw: string) => {
    setSelectedKeywords((prev) => (prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw]))
  }
  const toggleTrend = (t: string) => {
    setSelectedTrends((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }
  const addCustomKeyword = () => {
    const v = customKeyword.trim()
    if (v && !selectedKeywords.includes(v)) setSelectedKeywords((prev) => [...prev, v])
    setCustomKeyword('')
  }
  const addCustomTrend = () => {
    const v = customTrend.trim()
    if (v && !selectedTrends.includes(v)) setSelectedTrends((prev) => [...prev, v])
    setCustomTrend('')
  }

  const { mutate: create, isPending } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/content/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, title, hook: hook || undefined, format: format || undefined }),
      })
      if (!res.ok) throw new Error('Failed to create idea')
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ideas'] })
      setTitle('')
      setHook('')
      setFormat('')
      onClose()
    },
  })

  const { mutate: aiGenerate, isPending: isGenerating } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/content/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          title: 'AI Generated',
          autoGenerate: true,
          niche,
          keywords: selectedKeywords.length ? selectedKeywords : undefined,
          trendContext: selectedTrends.length ? selectedTrends : undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed to trigger generation')
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ideas'] })
      setNiche('')
      setSelectedKeywords([])
      setSelectedTrends([])
      onClose()
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Video Idea</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <Label>Niche / Topic (required for AI Generate)</Label>
            <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. 'Stoic philosophy quotes'" />
          </div>
          <div className="space-y-2">
            <Label>Keywords (optional, sharpens AI Generate)</Label>
            {availableKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {availableKeywords.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => toggleKeyword(kw)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      selectedKeywords.includes(kw)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted border-input'
                    }`}
                  >
                    {kw}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={customKeyword}
                onChange={(e) => setCustomKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomKeyword() } }}
                placeholder="Add a custom keyword"
                className="h-8 text-sm"
              />
              <Button type="button" size="sm" variant="outline" onClick={addCustomKeyword}>Add</Button>
            </div>
            {selectedKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedKeywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="cursor-pointer" onClick={() => toggleKeyword(kw)}>
                    {kw} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Trends (optional, sharpens AI Generate)</Label>
            {availableTrends.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {availableTrends.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTrend(t)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      selectedTrends.includes(t)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted border-input'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={customTrend}
                onChange={(e) => setCustomTrend(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTrend() } }}
                placeholder="Add a custom trend"
                className="h-8 text-sm"
              />
              <Button type="button" size="sm" variant="outline" onClick={addCustomTrend}>Add</Button>
            </div>
            {selectedTrends.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedTrends.map((t) => (
                  <Badge key={t} variant="secondary" className="cursor-pointer" onClick={() => toggleTrend(t)}>
                    {t} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your video idea title" />
          </div>
          <div className="space-y-2">
            <Label>Hook (optional)</Label>
            <Input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Opening hook or angle" />
          </div>
          <div className="space-y-2">
            <Label>Format (optional)</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as VideoFormat)}>
              <SelectTrigger>
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FORMAT_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => aiGenerate()} disabled={!niche.trim() || isGenerating || isPending}>
            {isGenerating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</> : <><Wand2 className="h-4 w-4 mr-2" />AI Generate</>}
          </Button>
          <Button onClick={() => create()} disabled={!title.trim() || isPending || isGenerating}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Idea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function IdeasPage() {
  const [showCreate, setShowCreate] = useState(false)
  const queryClient = useQueryClient()
  const activeChannel = useActiveChannel()

  const { data, isLoading } = useQuery({
    queryKey: ['ideas', activeChannel?.id],
    queryFn: async () => {
      if (!activeChannel) return { ideas: [] }
      const res = await fetch(`/api/content/ideas?channelId=${activeChannel.id}&limit=100`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ ideas: VideoIdea[] }>
    },
    enabled: !!activeChannel,
    refetchInterval: 30000,
  })

  const { mutate: updateStatus } = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: IdeaStatus }) => {
      const res = await fetch(`/api/content/ideas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to update')
      return res.json()
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ideas'] }),
  })

  const ideas = data?.ideas ?? []
  const byStatus = (status: IdeaStatus) => ideas.filter((i) => i.status === status)

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Lightbulb className="h-10 w-10 mb-3 opacity-30" />
        <p className="font-medium">No channel selected</p>
        <p className="text-sm">Select a channel from the sidebar to manage ideas</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Video Ideas</h1>
          <p className="text-muted-foreground mt-1">Manage your content pipeline from idea to production.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />New Idea
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(({ status, label, icon, color }) => (
            <div key={status} className={`rounded-xl border-2 ${color} p-3`}>
              <div className="flex items-center gap-2 mb-3">
                {icon}
                <span className="font-semibold text-sm">{label}</span>
                <Badge variant="secondary" className="ml-auto text-xs">{byStatus(status).length}</Badge>
              </div>
              <div className="space-y-2 min-h-32">
                {byStatus(status).map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onStatusChange={(id, s) => updateStatus({ id, status: s })}
                  />
                ))}
                {byStatus(status).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">No ideas here</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateIdeaDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        channelId={activeChannel.id}
      />
    </div>
  )
}
