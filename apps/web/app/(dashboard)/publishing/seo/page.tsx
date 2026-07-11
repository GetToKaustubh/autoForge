'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useActiveChannel } from '@/hooks/use-channel'
import { Search, Plus, Loader2, TrendingUp, Tag, AlignLeft, Star } from 'lucide-react'

interface SeoOptimization {
  id: string
  videoId: string
  optimizedTitle: string | null
  optimizedDescription: string | null
  tags: string[] | null
  hashtags: string[] | null
  chapters: Array<{ timestamp_sec: number; title: string }> | null
  titleScore: number | null
  descriptionScore: number | null
  tagScore: number | null
  overallScore: number | null
  modelUsed: string | null
  triggerJobId: string | null
  updatedAt: string
}

interface VideoForSeo {
  id: string
  title: string
  pipelineStage: string
  ytTitle: string | null
}

function ScoreBar({ score, label }: { score: number | null; label: string }) {
  if (score === null) return null
  const pct = Math.round(score * 100)
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function SeoCard({ seo, videoTitle }: { seo: SeoOptimization; videoTitle: string }) {
  const [expanded, setExpanded] = useState(false)
  const overallPct = seo.overallScore ? Math.round(seo.overallScore * 100) : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm truncate">{videoTitle}</CardTitle>
            {seo.optimizedTitle && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">→ {seo.optimizedTitle}</p>
            )}
          </div>
          {overallPct !== null && (
            <div className="flex items-center gap-1 shrink-0">
              <Star className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-sm font-bold">{overallPct}%</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <ScoreBar score={seo.titleScore} label="Title" />
          <ScoreBar score={seo.descriptionScore} label="Description" />
          <ScoreBar score={seo.tagScore} label="Tags" />
        </div>

        {seo.tags && seo.tags.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Tag className="w-3 h-3" />{seo.tags.length} tags</p>
            <div className="flex flex-wrap gap-1">
              {seo.tags.slice(0, expanded ? undefined : 6).map((t) => (
                <Badge key={t} variant="secondary" className="text-xs py-0">{t}</Badge>
              ))}
              {!expanded && seo.tags.length > 6 && (
                <button onClick={() => setExpanded(true)} className="text-xs text-primary hover:underline">
                  +{seo.tags.length - 6} more
                </button>
              )}
            </div>
          </div>
        )}

        {expanded && seo.optimizedDescription && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><AlignLeft className="w-3 h-3" />Description</p>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">{seo.optimizedDescription}</p>
          </div>
        )}

        {expanded && seo.chapters && seo.chapters.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Chapters</p>
            <div className="space-y-0.5">
              {seo.chapters.map((c) => {
                const mins = Math.floor(c.timestamp_sec / 60)
                const secs = c.timestamp_sec % 60
                return (
                  <p key={c.timestamp_sec} className="text-xs text-muted-foreground">
                    {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')} — {c.title}
                  </p>
                )
              })}
            </div>
          </div>
        )}

        {seo.optimizedDescription && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary hover:underline"
          >
            {expanded ? 'Show less' : 'Show description & chapters'}
          </button>
        )}

        <p className="text-xs text-muted-foreground">
          {seo.modelUsed ?? 'Claude'} · {new Date(seo.updatedAt).toLocaleDateString('en-IN')}
        </p>
      </CardContent>
    </Card>
  )
}

function RunSeoDialog({ videos }: { videos: VideoForSeo[] }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [videoId, setVideoId] = useState('')
  const [keywords, setKeywords] = useState('')
  const [niche, setNiche] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/publishing/seo/${videoId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetKeywords: keywords ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : undefined,
          channelNiche: niche || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to start SEO')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seo-list'] })
      setOpen(false)
    },
  })

  const eligibleVideos = videos.filter((v) =>
    ['rendered', 'seo_optimized', 'scheduled', 'uploaded', 'published'].includes(v.pipelineStage)
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" />Run SEO Optimization</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>SEO Optimization</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Video</Label>
            <Select value={videoId} onValueChange={setVideoId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a video" />
              </SelectTrigger>
              <SelectContent>
                {eligibleVideos.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.ytTitle ?? v.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligibleVideos.length === 0 && (
              <p className="text-xs text-muted-foreground">No eligible videos — render a video first.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Target Keywords (comma-separated, optional)</Label>
            <Input
              placeholder="AI automation, passive income, YouTube growth"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Channel Niche (optional)</Label>
            <Input
              placeholder="e.g. AI tools, finance, travel vlogging"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
            />
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}

          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!videoId || mutation.isPending}
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing…</>
            ) : (
              <><TrendingUp className="w-4 h-4 mr-2" />Optimize</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function SeoPage() {
  const activeChannel = useActiveChannel()

  const { data: videosData } = useQuery({
    queryKey: ['videos-for-seo', activeChannel?.id],
    queryFn: async () => {
      const res = await fetch(`/api/production/videos?channelId=${activeChannel!.id}&limit=50`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ videos: VideoForSeo[] }>
    },
    enabled: !!activeChannel,
  })

  const { data: seoData } = useQuery({
    queryKey: ['seo-list', activeChannel?.id],
    queryFn: async () => {
      // Fetch all videos and their SEO — paginate later
      const videos = videosData?.videos ?? []
      const seoResults = await Promise.all(
        videos
          .filter((v) => ['seo_optimized', 'scheduled', 'uploaded', 'published'].includes(v.pipelineStage))
          .map(async (v) => {
            const res = await fetch(`/api/publishing/seo/${v.id}`)
            if (!res.ok) return null
            const seo = await res.json() as SeoOptimization
            return { seo, video: v }
          })
      )
      return seoResults.filter(Boolean) as Array<{ seo: SeoOptimization; video: VideoForSeo }>
    },
    enabled: !!videosData,
    staleTime: 30_000,
  })

  const videos = videosData?.videos ?? []
  const seoList = seoData ?? []

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Search className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">No channel selected</h2>
        <p className="text-muted-foreground mt-2">Select a YouTube channel to manage SEO.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SEO Optimization</h1>
          <p className="text-muted-foreground text-sm mt-1">AI-powered title, description, and tag optimization</p>
        </div>
        <RunSeoDialog videos={videos} />
      </div>

      {seoList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-xl">
          <Search className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-medium">No SEO optimizations yet</p>
          <p className="text-sm text-muted-foreground mt-1">Run SEO analysis on rendered videos to improve discoverability.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {seoList.map(({ seo, video }) => (
            <SeoCard key={seo.id} seo={seo} videoTitle={video.ytTitle ?? video.title} />
          ))}
        </div>
      )}
    </div>
  )
}
