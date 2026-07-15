'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useActiveChannel } from '@/hooks/use-channel'
import {
  Video, Plus, Loader2, Play, Clapperboard, CheckCircle, XCircle, AlertCircle, ArrowRight,
  Smartphone, Sparkles, RefreshCw, Trash2, Pencil,
} from 'lucide-react'
import { SceneTimelineEditor, validateScenes, type EditorScene } from '@/components/production/scene-timeline-editor'

interface VideoItem {
  id: string
  title: string
  description: string | null
  contentType: 'video' | 'short'
  pipelineStage: PipelineStage
  scriptId: string | null
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

function EditVideoDialog({
  video,
  open,
  onClose,
  scripts,
}: {
  video: VideoItem
  open: boolean
  onClose: () => void
  scripts: Array<{ id: string; title: string; estimatedDurationSec: number | null }>
}) {
  const isShort = video.contentType === 'short'
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(video.title)
  const [description, setDescription] = useState(video.description ?? '')
  const [scriptId, setScriptId] = useState('')
  const [scenes, setScenes] = useState<EditorScene[]>([])
  const [provider, setProvider] = useState<'stock' | 'ai-image' | 'runway' | 'pika'>('stock')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(isShort ? '9:16' : '16:9')

  useEffect(() => {
    if (open) {
      setTitle(video.title)
      setDescription(video.description ?? '')
      setScriptId(video.scriptId ?? '')
      setScenes([])
      setProvider('stock')
      setAspectRatio(isShort ? '9:16' : '16:9')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, video.id])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: description || undefined }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save changes')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] })
    },
  })

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
  const narrationDurationSec = linkedVoiceGen?.totalDurationSec ?? selectedScript?.estimatedDurationSec ?? 60

  const validation = validateScenes(scenes, narrationDurationSec)
  const hasBlockingErrors = scenes.length > 0 && validation.errors.length > 0

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const payloadScenes = [...scenes]
        .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
        .map((s, i) => ({
          scene_index: i,
          prompt: s.visualPrompt.trim(),
          duration_sec: Math.max(1, s.endTimeSeconds - s.startTimeSeconds),
          visual_type: s.visualType,
        }))

      const res = await fetch(`/api/production/videos/${video.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptId: scriptId || undefined,
          voiceGenId: linkedVoiceGen?.id,
          scenes: payloadScenes,
          provider,
          aspectRatio,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to regenerate')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] })
      onClose()
    },
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Video</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Video title" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Video description (optional)"
              rows={3}
            />
          </div>
          {saveMutation.error && (
            <p className="text-sm text-destructive">{(saveMutation.error as Error).message}</p>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={title.trim().length < 3 || saveMutation.isPending}
          >
            {saveMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : 'Save Title & Description'}
          </Button>

          <div className="border-t pt-4 space-y-4">
            <div>
              <Label className="text-sm font-semibold">Regenerate Video</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Build new scenes and generate — this overwrites the current video's visuals once complete.
              </p>
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
              <Label>Scenes</Label>
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
              </div>
            )}

            {isShort ? (
              <div className="space-y-1">
                <Label>Aspect Ratio</Label>
                <p className="text-sm flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />9:16 Vertical — 1080×1920 (Shorts, locked)
                </p>
              </div>
            ) : scenes.length > 0 && (
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

            {regenerateMutation.error && (
              <p className="text-sm text-destructive">{(regenerateMutation.error as Error).message}</p>
            )}
            {hasBlockingErrors && (
              <p className="text-sm text-destructive">
                Fix the scene timeline issues above before regenerating.
              </p>
            )}

            <Button
              className="w-full"
              onClick={() => regenerateMutation.mutate()}
              disabled={scenes.length === 0 || regenerateMutation.isPending || hasBlockingErrors}
            >
              {regenerateMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting regeneration…</>
              ) : (
                <><RefreshCw className="w-4 h-4 mr-2" />Regenerate Video</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VideoCard({
  video,
  onRefetch,
  scripts,
}: {
  video: VideoItem
  onRefetch: () => void
  scripts: Array<{ id: string; title: string; estimatedDurationSec: number | null }>
}) {
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
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

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/videos/${video.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to remove video')
      if (res.status === 204) return null
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] })
    },
  })

  const removable = video.pipelineStage !== 'uploaded' && video.pipelineStage !== 'published'
  const completedScenes = video.scenes.filter((s) => s.status === 'completed').length
  const totalScenes = video.scenes.length
  const dur = video.durationSec ? `${Math.round(video.durationSec)}s` : null

  return (
    <Card className={video.pipelineStage === 'failed' ? 'border-destructive/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {video.contentType === 'short' && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700">
                  <Smartphone className="w-3 h-3" />Short
                </span>
              )}
            </div>
            <CardTitle className="text-base line-clamp-2">{video.title}</CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StageBadge stage={video.pipelineStage} />
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              title="Edit video"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {removable && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove "${video.title}"?`)) removeMutation.mutate()
                }}
                disabled={removeMutation.isPending}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                title="Remove video"
              >
                {removeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
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

        {removeMutation.error && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {(removeMutation.error as Error).message}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Created {new Date(video.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </CardContent>

      <EditVideoDialog video={video} open={editOpen} onClose={() => setEditOpen(false)} scripts={scripts} />
    </Card>
  )
}

const SHORT_TONES = [
  { value: 'punchy, fast-paced, energetic — written for YouTube Shorts', label: 'Punchy & Energetic' },
  { value: 'calm, informative, clear — written for YouTube Shorts', label: 'Calm & Informative' },
  { value: 'funny, casual, meme-aware — written for YouTube Shorts', label: 'Funny & Casual' },
  { value: 'dramatic, suspenseful, cinematic — written for YouTube Shorts', label: 'Dramatic & Suspenseful' },
]

function ShortScriptGenerator({
  channelId,
  onScriptReady,
}: {
  channelId: string
  onScriptReady: (scriptId: string) => void
}) {
  const queryClient = useQueryClient()
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState(SHORT_TONES[0]!.value)
  const [durationSec, setDurationSec] = useState(45)
  const [scriptId, setScriptId] = useState<string | null>(null)

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/production/videos/short-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, topic, tone, targetDurationSec: durationSec }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to generate script')
      return res.json() as Promise<{ id: string }>
    },
    onSuccess: (data) => {
      setScriptId(data.id)
      void queryClient.invalidateQueries({ queryKey: ['scripts-for-video'] })
    },
  })

  const { data: script } = useQuery({
    queryKey: ['short-script-status', scriptId],
    queryFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}`)
      if (!res.ok) throw new Error('Failed to load script')
      return res.json() as Promise<{ id: string; title: string; status: string; triggerJobId: string | null; wordCount: number | null; estimatedDurationSec: number | null }>
    },
    enabled: !!scriptId,
    refetchInterval: (q) => {
      const s = q.state.data
      if (!s) return 2000
      const isGenerating = !!s.triggerJobId && s.status === 'draft' && !s.wordCount
      return isGenerating ? 2000 : false
    },
  })

  const isGenerating = generateMutation.isPending || (!!script && !!script.triggerJobId && script.status === 'draft' && !script.wordCount)

  // Notify the parent dialog once the script actually finishes (word count
  // lands) so it can link it into the video being created. The parent hides
  // this whole component as soon as scriptId is set (it shows its own
  // Regenerate/edit-link controls next to the Link Script dropdown instead,
  // which also covers scripts picked from that dropdown, not just ones
  // generated here).
  useEffect(() => {
    if (script?.wordCount && scriptId) onScriptReady(scriptId)
  }, [script?.wordCount, scriptId, onScriptReady])

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Topic / Idea</Label>
        <Input
          placeholder="e.g. 3 productivity hacks that actually work"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Tone</Label>
          <Select value={tone} onValueChange={setTone}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SHORT_TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Target Duration: {durationSec}s</Label>
          <input
            type="range" min={15} max={60} step={1}
            value={durationSec}
            onChange={(e) => setDurationSec(parseInt(e.target.value))}
            className="w-full h-9 accent-primary"
          />
        </div>
      </div>
      {generateMutation.error && (
        <p className="text-xs text-destructive">{(generateMutation.error as Error).message}</p>
      )}
      <Button
        type="button" size="sm"
        onClick={() => generateMutation.mutate()}
        disabled={topic.trim().length < 3 || isGenerating}
      >
        {isGenerating ? (
          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Writing script…</>
        ) : (
          <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate Script with AI</>
        )}
      </Button>
    </div>
  )
}

function CreateVideoDialog({
  scripts,
  contentType,
}: {
  scripts: Array<{ id: string; title: string; estimatedDurationSec: number | null }>
  contentType: 'video' | 'short'
}) {
  const isShort = contentType === 'short'
  const queryClient = useQueryClient()
  const activeChannel = useActiveChannel()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [scriptId, setScriptId] = useState('')
  const [scenes, setScenes] = useState<EditorScene[]>([])
  const [provider, setProvider] = useState<'stock' | 'ai-image' | 'runway' | 'pika'>('stock')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(isShort ? '9:16' : '16:9')

  const handleScriptReady = useCallback((id: string) => {
    setScriptId(id)
    setScenes([])
  }, [])

  const regenerateScriptMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}/regenerate`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to regenerate')
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['voice-for-video', scriptId] })
    },
  })

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
          contentType,
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
        <Button variant={isShort ? 'outline' : 'default'}>
          {isShort ? <Smartphone className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {isShort ? 'New Short' : 'New Video'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isShort ? 'Create Short' : 'Create Video'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>{isShort ? 'Short Title *' : 'Video Title *'}</Label>
            <Input placeholder={isShort ? 'Short title' : 'Video title'} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {isShort && !scriptId && activeChannel && (
            <div className="space-y-2">
              <Label>Generate Script</Label>
              <ShortScriptGenerator channelId={activeChannel.id} onScriptReady={handleScriptReady} />
              <p className="text-xs text-muted-foreground">or pick an existing script below</p>
            </div>
          )}

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
            {isShort && scriptId && (
              <div className="flex items-center gap-2">
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => regenerateScriptMutation.mutate()}
                  disabled={regenerateScriptMutation.isPending}
                >
                  {regenerateScriptMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Regenerating…</>
                  ) : (
                    <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Regenerate Script</>
                  )}
                </Button>
                <a href={`/content/scripts/${scriptId}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Edit full script
                </a>
              </div>
            )}
            {regenerateScriptMutation.error && (
              <p className="text-xs text-destructive">{(regenerateScriptMutation.error as Error).message}</p>
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

          {isShort ? (
            <div className="space-y-1">
              <Label>Aspect Ratio</Label>
              <p className="text-sm flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" />9:16 Vertical — 1080×1920 (Shorts, locked)
              </p>
            </div>
          ) : scenes.length > 0 && (
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
            ) : isShort ? (
              <><Smartphone className="w-4 h-4 mr-2" />Create Short</>
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
      const res = await fetch(`/api/content/scripts?channelId=${activeChannel!.id}&limit=50&activeIdeaOnly=true`)
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
        <div className="flex items-center gap-2">
          <CreateVideoDialog scripts={scripts} contentType="video" />
          <CreateVideoDialog scripts={scripts} contentType="short" />
        </div>
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
                {inProgress.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} scripts={scripts} />)}
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
                {ready.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} scripts={scripts} />)}
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
                {scheduled.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} scripts={scripts} />)}
              </div>
            </section>
          )}

          {drafts.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3 text-muted-foreground">Drafts ({drafts.length})</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {drafts.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} scripts={scripts} />)}
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
                {failed.map((v) => <VideoCard key={v.id} video={v} onRefetch={refetch} scripts={scripts} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
