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
import { useActiveChannel } from '@/hooks/use-channel'
import { Video, Plus, Loader2, Play, Clapperboard, CheckCircle, XCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { SceneTimelineEditor, validateScenes, type EditorScene } from '@/components/production/scene-timeline-editor'

interface VideoItem {
  id: string
  title: string
  pipelineStage: PipelineStage
  scenes: Array<{ scene_index: number; status: string }>
  finalVideoUrl: string | null
  durationSec: number | null
  ytVideoId: string | null
  createdAt: string
}

type PipelineStage =
  | 'draft' | 'script_ready' | 'voice_ready' | 'scenes_generating' | 'scenes_ready'
  | 'editing' | 'render_queue' | 'rendered' | 'seo_optimized' | 'scheduled'
  | 'uploaded' | 'published' | 'failed'

const STAGE_ORDER: PipelineStage[] = [
  'draft', 'script_ready', 'voice_ready', 'scenes_generating', 'scenes_ready',
  'editing', 'render_queue', 'rendered', 'seo_optimized', 'scheduled',
  'uploaded', 'published',
]

const STAGE_LABELS: Record<PipelineStage, string> = {
  draft: 'Draft',
  script_ready: 'Script Ready',
  voice_ready: 'Voice Ready',
  scenes_generating: 'Generating Scenes',
  scenes_ready: 'Scenes Ready',
  editing: 'Editing',
  render_queue: 'In Render Queue',
  rendered: 'Rendered',
  seo_optimized: 'SEO Optimized',
  scheduled: 'Scheduled',
  uploaded: 'Uploaded',
  published: 'Published',
  failed: 'Failed',
}

const STAGE_COLORS: Record<PipelineStage, string> = {
  draft: 'bg-gray-100 text-gray-600',
  script_ready: 'bg-blue-100 text-blue-700',
  voice_ready: 'bg-indigo-100 text-indigo-700',
  scenes_generating: 'bg-yellow-100 text-yellow-700',
  scenes_ready: 'bg-orange-100 text-orange-700',
  editing: 'bg-purple-100 text-purple-700',
  render_queue: 'bg-violet-100 text-violet-700',
  rendered: 'bg-emerald-100 text-emerald-700',
  seo_optimized: 'bg-cyan-100 text-cyan-700',
  scheduled: 'bg-teal-100 text-teal-700',
  uploaded: 'bg-green-100 text-green-700',
  published: 'bg-green-600 text-white',
  failed: 'bg-red-100 text-red-700',
}

const ACTIVE_STAGES = new Set<PipelineStage>(['scenes_generating', 'editing', 'render_queue'])

function StageBadge({ stage }: { stage: PipelineStage }) {
  const isActive = ACTIVE_STAGES.has(stage)
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STAGE_COLORS[stage]}`}>
      {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
      {stage === 'published' && <CheckCircle className="w-3 h-3" />}
      {stage === 'failed' && <XCircle className="w-3 h-3" />}
      {STAGE_LABELS[stage]}
    </span>
  )
}

function PipelineProgress({ stage }: { stage: PipelineStage }) {
  if (stage === 'failed') return null
  const idx = STAGE_ORDER.indexOf(stage)
  const total = STAGE_ORDER.length
  const pct = idx < 0 ? 0 : Math.round((idx / (total - 1)) * 100)

  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{pct}% complete</p>
    </div>
  )
}

function VideoCard({ video, onRefetch }: { video: VideoItem; onRefetch: () => void }) {
  const queryClient = useQueryClient()
  const isActive = ACTIVE_STAGES.has(video.pipelineStage)

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(onRefetch, 5000)
    return () => clearInterval(interval)
  }, [isActive, onRefetch])

  const renderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/videos/${video.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addCaptions: false }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to start render')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] })
    },
  })

  const completedScenes = video.scenes.filter((s) => s.status === 'completed').length
  const totalScenes = video.scenes.length
  const dur = video.durationSec ? `${Math.round(video.durationSec)}s` : null

  return (
    <Card className={video.pipelineStage === 'failed' ? 'border-destructive/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base line-clamp-2">{video.title}</CardTitle>
          <StageBadge stage={video.pipelineStage} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <PipelineProgress stage={video.pipelineStage} />

        {totalScenes > 0 && (
          <p className="text-sm text-muted-foreground">
            {completedScenes}/{totalScenes} scenes ready
            {dur ? ` · ${dur}` : ''}
          </p>
        )}

        {video.finalVideoUrl && (
          <a
            href={video.finalVideoUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Play className="w-4 h-4" />
            Preview final video
          </a>
        )}

        {video.ytVideoId && (
          <a
            href={`https://youtube.com/watch?v=${video.ytVideoId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-red-600 hover:underline"
          >
            <Video className="w-4 h-4" />
            View on YouTube
          </a>
        )}

        {video.pipelineStage === 'scenes_ready' && (
          <Button
            size="sm"
            onClick={() => renderMutation.mutate()}
            disabled={renderMutation.isPending}
          >
            {renderMutation.isPending ? (
              <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Starting render…</>
            ) : (
              <><Clapperboard className="w-3 h-3 mr-2" />Render Video</>
            )}
          </Button>
        )}

        {renderMutation.error && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {(renderMutation.error as Error).message}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Created {new Date(video.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </CardContent>
    </Card>
  )
}

function CreateVideoDialog({ scripts }: { scripts: Array<{ id: string; title: string; estimatedDurationSec: number | null }> }) {
  const queryClient = useQueryClient()
  const activeChannel = useActiveChannel()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [scriptId, setScriptId] = useState('')
  const [scenes, setScenes] = useState<EditorScene[]>([])
  const [provider, setProvider] = useState<'stock' | 'ai-image' | 'runway' | 'pika'>('stock')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9')

  const { data: voiceGensData } = useQuery({
    queryKey: ['voice-for-video', scriptId],
    queryFn: async () => {
      const res = await fetch(`/api/production/voice?scriptId=${scriptId}&limit=10`)
      if (!res.ok) throw new Error('Failed to fetch voice generations')
      return res.json() as Promise<{ voiceGenerations: Array<{ id: string; status: string; fullAudioUrl: string | null; totalDurationSec: number | null }> }>
    },
    enabled: !!scriptId,
  })
  const linkedVoiceGen = voiceGensData?.voiceGenerations.find((v) => v.status === 'completed')
  const selectedScript = scripts.find((s) => s.id === scriptId)
  // Prefer the voice generation's own measured duration (real, from Cloudinary)
  // over the script's AI-estimated duration when both are available.
  const narrationDurationSec = linkedVoiceGen?.totalDurationSec ?? selectedScript?.estimatedDurationSec ?? 60

  const validation = validateScenes(scenes, narrationDurationSec)
  const hasBlockingErrors = scenes.length > 0 && validation.errors.length > 0

  const mutation = useMutation({
    mutationFn: async () => {
      const payloadScenes = [...scenes]
        .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
        .map((s, i) => ({
          scene_index: i,
          prompt: s.visualPrompt.trim(),
          duration_sec: Math.max(1, s.endTimeSeconds - s.startTimeSeconds),
          visual_type: s.visualType,
        }))

      const res = await fetch('/api/production/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: activeChannel!.id,
          title,
          scriptId: scriptId || undefined,
          voiceGenId: linkedVoiceGen?.id,
          scenes: payloadScenes.length > 0 ? payloadScenes : undefined,
          provider,
          aspectRatio,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] })
      setOpen(false)
      setTitle('')
      setScriptId('')
      setScenes([])
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" />New Video</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Video</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Video Title *</Label>
            <Input placeholder="Video title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Link Script (optional)</Label>
            <Select value={scriptId} onValueChange={(v) => { setScriptId(v); setScenes([]) }}>
              <SelectTrigger>
                <SelectValue placeholder="Select a script" />
              </SelectTrigger>
              <SelectContent>
                {scripts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scriptId && (
              <p className="text-xs text-muted-foreground">
                {linkedVoiceGen
                  ? '✓ Voice narration will be attached automatically'
                  : 'No completed voice generation for this script — video will render without narration audio'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Scenes (optional — leave empty to add later)</Label>
            <SceneTimelineEditor
              scenes={scenes}
              onChange={setScenes}
              narrationDurationSec={narrationDurationSec}
              narrationAudioUrl={linkedVoiceGen?.fullAudioUrl ?? undefined}
              scriptId={scriptId || undefined}
            />
          </div>

          {scenes.length > 0 && (
            <div className="space-y-2">
              <Label>Video Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as 'stock' | 'ai-image' | 'runway' | 'pika')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock Footage — Pexels (free)</SelectItem>
                  <SelectItem value="ai-image">AI Images — Pollinations (free)</SelectItem>
                  <SelectItem value="runway">Runway Gen-3 (~$0.25/scene)</SelectItem>
                  <SelectItem value="pika">Pika Labs (~$0.20/scene)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Stock footage matches each scene prompt to free Pexels video/photos — best for
                quote/facts-style content. AI Images generates a free synthetic image per scene from
                your own prompt (better for fictional/stylized scenes stock can't match) and animates
                it with a slow zoom/pan. Runway/Pika generate original AI video per scene (paid).
              </p>
            </div>
          )}

          {scenes.length > 0 && (
            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as '16:9' | '9:16')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 Landscape</SelectItem>
                  <SelectItem value="9:16">9:16 Vertical (Shorts)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          {hasBlockingErrors && (
            <p className="text-sm text-destructive">
              Fix the scene timeline issues above before creating the video.
            </p>
          )}

          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!title || !activeChannel || mutation.isPending || hasBlockingErrors}
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</>
            ) : (
              <><Video className="w-4 h-4 mr-2" />Create Video</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function VideosPage() {
  const activeChannel = useActiveChannel()

  const { data: videosData, refetch } = useQuery({
    queryKey: ['videos', activeChannel?.id],
    queryFn: async () => {
      const params = activeChannel ? `?channelId=${activeChannel.id}` : ''
      const res = await fetch(`/api/production/videos${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ videos: VideoItem[] }>
    },
    enabled: !!activeChannel,
    staleTime: 10_000,
  })

  const { data: scriptsData } = useQuery({
    queryKey: ['scripts-for-video', activeChannel?.id],
    queryFn: async () => {
      const res = await fetch(`/api/content/scripts?channelId=${activeChannel!.id}&limit=50`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ scripts: Array<{ id: string; title: string; estimatedDurationSec: number | null }> }>
    },
    enabled: !!activeChannel,
  })

  const videosList = videosData?.videos ?? []
  const scripts = scriptsData?.scripts ?? []

  // Group by stage category
  const inProgress = videosList.filter((v) => ACTIVE_STAGES.has(v.pipelineStage) || v.pipelineStage === 'render_queue')
  const ready = videosList.filter((v) => v.pipelineStage === 'scenes_ready' || v.pipelineStage === 'rendered' || v.pipelineStage === 'seo_optimized')
  const scheduled = videosList.filter((v) => v.pipelineStage === 'scheduled' || v.pipelineStage === 'uploaded' || v.pipelineStage === 'published')
  const drafts = videosList.filter((v) => v.pipelineStage === 'draft' || v.pipelineStage === 'script_ready' || v.pipelineStage === 'voice_ready')
  const failed = videosList.filter((v) => v.pipelineStage === 'failed')

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Video className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">No channel selected</h2>
        <p className="text-muted-foreground mt-2">Select a YouTube channel to manage videos.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Video Pipeline</h1>
          <p className="text-muted-foreground text-sm mt-1">Track videos through generation and rendering</p>
        </div>
        <CreateVideoDialog scripts={scripts} />
      </div>

      {videosList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-xl">
          <Video className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-medium">No videos yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first video to start the production pipeline.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {inProgress.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                In Progress ({inProgress.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {inProgress.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} />)}
              </div>
            </section>
          )}

          {ready.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-orange-500" />
                Action Required ({ready.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {ready.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} />)}
              </div>
            </section>
          )}

          {scheduled.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Published / Scheduled ({scheduled.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {scheduled.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} />)}
              </div>
            </section>
          )}

          {drafts.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3 text-muted-foreground">Drafts ({drafts.length})</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {drafts.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} />)}
              </div>
            </section>
          )}

          {failed.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-destructive">
                <XCircle className="w-4 h-4" />
                Failed ({failed.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {failed.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
