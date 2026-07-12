'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, Plus, Wand2, Loader2, Clock, CheckCircle, Pencil } from 'lucide-react'
import { useActiveChannel } from '@/hooks/use-channel'

type ScriptStatus = 'draft' | 'review' | 'approved' | 'in_production' | 'archived'

interface Script {
  id: string
  title: string
  status: ScriptStatus
  wordCount: number | null
  estimatedDurationSec: number | null
  version: number
  modelUsed: string | null
  triggerJobId: string | null
  ideaId: string | null
  channelId: string
  createdAt: string
  updatedAt: string
}

const STATUS_BADGE: Record<ScriptStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  review: { label: 'Review', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'default' },
  in_production: { label: 'In Production', variant: 'default' },
  archived: { label: 'Archived', variant: 'outline' },
}

function formatDuration(sec: number | null) {
  if (!sec) return null
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function CreateScriptDialog({ open, onClose, channelId }: { open: boolean; onClose: () => void; channelId: string }) {
  const [title, setTitle] = useState('')
  const [withAI, setWithAI] = useState(false)
  const [ideaId, setIdeaId] = useState('')
  const [duration, setDuration] = useState('600')
  const [tone, setTone] = useState('engaging and educational')
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: ideasData } = useQuery({
    queryKey: ['ideas-for-script', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/content/ideas?channelId=${channelId}&limit=100`)
      if (!res.ok) throw new Error('Failed to fetch ideas')
      return res.json() as Promise<{ ideas: { id: string; title: string; status: string }[] }>
    },
    enabled: open,
  })
  const linkableIdeas = (ideasData?.ideas ?? []).filter((i) => i.status === 'approved' || i.status === 'in_production')

  const { mutate: create, isPending } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/content/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          title,
          generateWithAI: withAI,
          ideaId: ideaId || undefined,
          targetDurationSec: parseInt(duration),
          tone,
        }),
      })
      if (!res.ok) throw new Error('Failed to create script')
      return res.json() as Promise<Script>
    },
    onSuccess: (script) => {
      void queryClient.invalidateQueries({ queryKey: ['scripts'] })
      setIdeaId('')
      onClose()
      router.push(`/content/scripts/${script.id}`)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Script</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Script title" />
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border">
            <input
              type="checkbox"
              id="withAI"
              checked={withAI}
              onChange={(e) => setWithAI(e.target.checked)}
              className="rounded"
            />
            <div>
              <label htmlFor="withAI" className="text-sm font-medium cursor-pointer flex items-center gap-1.5">
                <Wand2 className="h-3.5 w-3.5" />Generate with AI
              </label>
              <p className="text-xs text-muted-foreground">Gemini will write the full script</p>
            </div>
          </div>
          {withAI && (
            <>
              <div className="space-y-2">
                <Label>Idea to write from (required)</Label>
                <Select value={ideaId} onValueChange={setIdeaId}>
                  <SelectTrigger>
                    <SelectValue placeholder={linkableIdeas.length ? 'Select an idea' : 'No approved ideas yet'} />
                  </SelectTrigger>
                  <SelectContent>
                    {linkableIdeas.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target Duration</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="300">5 minutes</SelectItem>
                    <SelectItem value="600">10 minutes</SelectItem>
                    <SelectItem value="900">15 minutes</SelectItem>
                    <SelectItem value="1200">20 minutes</SelectItem>
                    <SelectItem value="1800">30 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tone</Label>
                <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. engaging and educational" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => create()} disabled={!title.trim() || (withAI && !ideaId) || isPending}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{withAI ? 'Generating...' : 'Creating...'}</> : 'Create Script'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ScriptsPage() {
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ScriptStatus | 'all'>('all')
  const router = useRouter()
  const activeChannel = useActiveChannel()

  const { data, isLoading } = useQuery({
    queryKey: ['scripts', activeChannel?.id, statusFilter],
    queryFn: async () => {
      if (!activeChannel) return { scripts: [] }
      const params = new URLSearchParams({ channelId: activeChannel.id, limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/content/scripts?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ scripts: Script[] }>
    },
    enabled: !!activeChannel,
    refetchInterval: (q) => {
      const scripts = q.state.data?.scripts ?? []
      const hasGenerating = scripts.some((s) => s.triggerJobId && s.status === 'draft' && !s.wordCount)
      return hasGenerating ? 5000 : false
    },
  })

  const scripts = data?.scripts ?? []

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <FileText className="h-10 w-10 mb-3 opacity-30" />
        <p className="font-medium">No channel selected</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scripts</h1>
          <p className="text-muted-foreground mt-1">Write, review, and approve video scripts.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />New Script
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['all', 'draft', 'review', 'approved', 'in_production'] as const).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : STATUS_BADGE[s]?.label ?? s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : scripts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No scripts yet</p>
          <p className="text-sm mt-1">Create your first script manually or let AI write it</p>
        </div>
      ) : (
        <div className="space-y-3">
          {scripts.map((script) => {
            const isGenerating = !!script.triggerJobId && script.status === 'draft' && !script.wordCount
            return (
              <Card
                key={script.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/content/scripts/${script.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm truncate">{script.title}</h3>
                        {isGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {script.wordCount ? (
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />{script.wordCount.toLocaleString()} words
                          </span>
                        ) : isGenerating ? (
                          <span>Generating...</span>
                        ) : null}
                        {script.estimatedDurationSec && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />{formatDuration(script.estimatedDurationSec)}
                          </span>
                        )}
                        {script.modelUsed && <span>{script.modelUsed}</span>}
                        <span>v{script.version}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_BADGE[script.status]?.variant ?? 'outline'}>
                        {STATUS_BADGE[script.status]?.label ?? script.status}
                      </Badge>
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <CreateScriptDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        channelId={activeChannel.id}
      />
    </div>
  )
}
