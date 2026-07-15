'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useActiveChannel } from '@/hooks/use-channel'
import { ImageIcon, Plus, Loader2, CheckCircle, XCircle, Clock, Download, Check, RefreshCw } from 'lucide-react'
import Image from 'next/image'

interface Thumbnail {
  id: string
  prompt: string
  style: string | null
  variants: Array<{ url: string; prompt: string; variant: number }>
  selectedUrl: string | null
  generationModel: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  errorMessage: string | null
  createdAt: string
}

const STYLES = [
  { value: 'bold', label: 'Bold & Dramatic' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'viral', label: 'Viral Style' },
  { value: 'educational', label: 'Educational' },
]

function StatusBadge({ status }: { status: Thumbnail['status'] }) {
  if (status === 'completed') return <Badge className="bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>
  if (status === 'failed') return <Badge className="bg-red-500/10 text-red-600 border-red-500/20"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>
  if (status === 'processing') return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>
  return <Badge className="bg-gray-500/10 text-gray-600 border-gray-500/20"><Clock className="w-3 h-3 mr-1" />Pending</Badge>
}

function ThumbnailCard({ thumb, onRefetch }: { thumb: Thumbnail; onRefetch: () => void }) {
  const queryClient = useQueryClient()
  const isActive = thumb.status === 'pending' || thumb.status === 'processing'

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(onRefetch, 5000)
    return () => clearInterval(interval)
  }, [isActive, onRefetch])

  const selectMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(`/api/production/thumbnails/${thumb.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedUrl: url }),
      })
      if (!res.ok) throw new Error('Failed to select thumbnail')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thumbnails'] })
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/thumbnails/${thumb.id}/regenerate`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to regenerate')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thumbnails'] })
    },
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm truncate">{thumb.prompt}</CardTitle>
            {thumb.style && <p className="text-xs text-muted-foreground mt-0.5 capitalize">{thumb.style}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={thumb.status} />
            {!isActive && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Regenerate this thumbnail? Current variants will be replaced.')) regenerateMutation.mutate()
                }}
                disabled={regenerateMutation.isPending}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Regenerate"
              >
                {regenerateMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
        {regenerateMutation.error && (
          <p className="text-xs text-destructive mt-1">{(regenerateMutation.error as Error).message}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {thumb.status === 'processing' && (
          <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Generating thumbnails…</p>
              <p className="text-xs text-muted-foreground">Pollinations.ai, ~30 seconds each</p>
            </div>
          </div>
        )}
        {thumb.status === 'completed' && thumb.variants.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {thumb.variants.map((v) => (
                <div key={v.variant} className="relative group">
                  <div className="relative aspect-video rounded overflow-hidden border-2 transition-colors"
                    style={{ borderColor: thumb.selectedUrl === v.url ? 'rgb(59 130 246)' : 'transparent' }}>
                    <Image src={v.url} alt={`Variant ${v.variant}`} fill className="object-cover" sizes="200px" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                        <button
                          onClick={() => selectMutation.mutate(v.url)}
                          className="bg-white text-black rounded-full p-1 hover:bg-blue-500 hover:text-white transition-colors"
                          title="Select this thumbnail"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <a href={v.url} download target="_blank" rel="noreferrer"
                          className="bg-white text-black rounded-full p-1 hover:bg-gray-100 transition-colors"
                          title="Download">
                          <Download className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                  {thumb.selectedUrl === v.url && (
                    <div className="absolute -top-1 -right-1 bg-blue-500 text-white rounded-full p-0.5">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Click a thumbnail to select it</p>
          </div>
        )}
        {thumb.status === 'failed' && (
          <p className="text-sm text-destructive">{thumb.errorMessage ?? 'Generation failed'}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {new Date(thumb.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </CardContent>
    </Card>
  )
}

function GenerateThumbnailDialog() {
  const queryClient = useQueryClient()
  const activeChannel = useActiveChannel()
  const [open, setOpen] = useState(false)
  const [videoTitle, setVideoTitle] = useState('')
  const [style, setStyle] = useState('bold')
  const [prompt, setPrompt] = useState('')
  const [variantCount, setVariantCount] = useState('3')

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/production/thumbnails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: activeChannel!.id,
          videoTitle,
          style,
          prompt: prompt || undefined,
          variantCount: parseInt(variantCount),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thumbnails'] })
      setOpen(false)
      setVideoTitle('')
      setPrompt('')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" />Generate Thumbnails</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Thumbnails</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Video Title *</Label>
            <Input
              placeholder="e.g. 10 AI Tools That Will Replace Programmers in 2025"
              value={videoTitle}
              onChange={(e) => setVideoTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Style</Label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Additional Concept (optional)</Label>
            <Textarea
              placeholder="Describe visual elements, colors, mood, or specific imagery to include"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Variants</Label>
            <Select value={variantCount} onValueChange={setVariantCount}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 variant (free)</SelectItem>
                <SelectItem value="2">2 variants (free)</SelectItem>
                <SelectItem value="3">3 variants (free)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}

          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!videoTitle || !activeChannel || mutation.isPending}
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
            ) : (
              <><ImageIcon className="w-4 h-4 mr-2" />Generate</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function ThumbnailsPage() {
  const activeChannel = useActiveChannel()

  const { data, refetch } = useQuery({
    queryKey: ['thumbnails', activeChannel?.id],
    queryFn: async () => {
      const params = activeChannel ? `?channelId=${activeChannel.id}` : ''
      const res = await fetch(`/api/production/thumbnails${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ thumbnails: Thumbnail[] }>
    },
    enabled: !!activeChannel,
    staleTime: 10_000,
  })

  const thumbnails = data?.thumbnails ?? []

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageIcon className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">No channel selected</h2>
        <p className="text-muted-foreground mt-2">Select a YouTube channel to generate thumbnails.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Thumbnails</h1>
          <p className="text-muted-foreground text-sm mt-1">Generate YouTube thumbnails using Pollinations.ai</p>
        </div>
        <GenerateThumbnailDialog />
      </div>

      {thumbnails.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-xl">
          <ImageIcon className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-medium">No thumbnails yet</p>
          <p className="text-sm text-muted-foreground mt-1">Generate eye-catching thumbnails for your videos.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {thumbnails.map((t) => (
            <ThumbnailCard key={t.id} thumb={t} onRefetch={refetch} />
          ))}
        </div>
      )}
    </div>
  )
}
