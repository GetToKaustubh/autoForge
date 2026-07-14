'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DualRangeSlider } from '@/components/ui/dual-range-slider'
import {
  Plus, Trash2, Copy, ChevronUp, ChevronDown, Loader2, Sparkles,
  AlertTriangle, AlertCircle, CheckCircle2, Play, GripVertical,
} from 'lucide-react'

export interface EditorScene {
  id: string
  startTimeSeconds: number
  endTimeSeconds: number
  visualPrompt: string
  visualType: 'auto' | 'stock' | 'ai-image' | 'runway' | 'pika'
  generationMode: 'manual' | 'ai'
}

const VISUAL_TYPE_LABELS: Record<EditorScene['visualType'], string> = {
  auto: 'Auto (use video provider)',
  stock: 'Stock Video',
  'ai-image': 'AI Image',
  runway: 'AI Video — Runway',
  pika: 'AI Video — Pika',
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// Returns null for anything that isn't exactly MM:SS with a valid seconds part -
// caller decides whether to reject or ignore an in-progress keystroke.
function parseTime(input: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(input.trim())
  if (!match) return null
  const minutes = parseInt(match[1]!, 10)
  const seconds = parseInt(match[2]!, 10)
  return minutes * 60 + seconds
}

function newScene(start: number, end: number, mode: EditorScene['generationMode'] = 'manual'): EditorScene {
  return {
    id: crypto.randomUUID(),
    startTimeSeconds: start,
    endTimeSeconds: end,
    visualPrompt: '',
    visualType: 'auto',
    generationMode: mode,
  }
}

interface ValidationResult {
  errors: string[]
  warnings: string[]
  overlapIds: Set<string>
  coverageSec: number
  coveragePct: number
}

function validateScenes(scenes: EditorScene[], narrationDurationSec: number): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const overlapIds = new Set<string>()

  const sorted = [...scenes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)

  for (const s of scenes) {
    if (s.endTimeSeconds <= s.startTimeSeconds) {
      errors.push(`A scene has an end time that isn't after its start time.`)
    }
    if (s.startTimeSeconds < 0) {
      errors.push(`A scene starts before 00:00.`)
    }
    if (narrationDurationSec > 0 && s.endTimeSeconds > narrationDurationSec) {
      const over = s.endTimeSeconds - narrationDurationSec
      errors.push(`A scene exceeds the narration duration by ${formatTime(over)}.`)
    }
    if (!s.visualPrompt.trim()) {
      errors.push(`A scene is missing a visual prompt.`)
    }
  }

  if (sorted.length > 0 && sorted[0]!.startTimeSeconds > 0) {
    warnings.push(`${formatTime(sorted[0]!.startTimeSeconds)} of narration before the first scene isn't covered.`)
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (b.startTimeSeconds < a.endTimeSeconds) {
      const overlap = a.endTimeSeconds - b.startTimeSeconds
      warnings.push(`Scenes overlap by ${formatTime(overlap)}.`)
      overlapIds.add(a.id)
      overlapIds.add(b.id)
      errors.push('Overlapping scenes must be resolved before creating the video.')
    } else if (b.startTimeSeconds > a.endTimeSeconds) {
      const gap = b.startTimeSeconds - a.endTimeSeconds
      warnings.push(`${formatTime(gap)} gap between scenes at ${formatTime(a.endTimeSeconds)}.`)
    }
  }

  const lastScene = sorted[sorted.length - 1]
  if (lastScene && narrationDurationSec > 0 && lastScene.endTimeSeconds < narrationDurationSec) {
    const uncovered = narrationDurationSec - lastScene.endTimeSeconds
    warnings.push(`${formatTime(uncovered)} of narration after the last scene isn't covered by any visual scene.`)
  }

  // Union of covered ranges (so overlapping time isn't double-counted)
  let coverageSec = 0
  let cursor = -Infinity
  for (const s of sorted) {
    const start = Math.max(s.startTimeSeconds, cursor)
    if (s.endTimeSeconds > start) coverageSec += s.endTimeSeconds - start
    cursor = Math.max(cursor, s.endTimeSeconds)
  }
  const coveragePct = narrationDurationSec > 0 ? Math.min(100, (coverageSec / narrationDurationSec) * 100) : 0

  return { errors, warnings, overlapIds, coverageSec, coveragePct }
}

function SceneCard({
  scene,
  index,
  total,
  narrationDurationSec,
  hasOverlap,
  scriptId,
  onChange,
  onDuplicate,
  onDelete,
  onMove,
  onPreview,
}: {
  scene: EditorScene
  index: number
  total: number
  narrationDurationSec: number
  hasOverlap: boolean
  scriptId?: string
  onChange: (patch: Partial<EditorScene>) => void
  onDuplicate: () => void
  onDelete: () => void
  onMove: (direction: 'up' | 'down') => void
  onPreview: () => void
}) {
  const [startInput, setStartInput] = useState(formatTime(scene.startTimeSeconds))
  const [endInput, setEndInput] = useState(formatTime(scene.endTimeSeconds))
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)

  // Keep text inputs in sync when the slider (or anything else) changes the source of truth
  if (formatTime(scene.startTimeSeconds) !== startInput && document.activeElement?.getAttribute('data-scene-field') !== `start-${scene.id}`) {
    setStartInput(formatTime(scene.startTimeSeconds))
  }
  if (formatTime(scene.endTimeSeconds) !== endInput && document.activeElement?.getAttribute('data-scene-field') !== `end-${scene.id}`) {
    setEndInput(formatTime(scene.endTimeSeconds))
  }

  const commitStart = (raw: string) => {
    const sec = parseTime(raw)
    if (sec === null) { setStartInput(formatTime(scene.startTimeSeconds)); return }
    const clamped = Math.max(0, Math.min(sec, scene.endTimeSeconds - 1))
    onChange({ startTimeSeconds: clamped })
    setStartInput(formatTime(clamped))
  }
  const commitEnd = (raw: string) => {
    const sec = parseTime(raw)
    if (sec === null) { setEndInput(formatTime(scene.endTimeSeconds)); return }
    const max = narrationDurationSec > 0 ? narrationDurationSec : sec
    const clamped = Math.max(scene.startTimeSeconds + 1, Math.min(sec, max))
    onChange({ endTimeSeconds: clamped })
    setEndInput(formatTime(clamped))
  }

  const duration = scene.endTimeSeconds - scene.startTimeSeconds
  const sliderMax = Math.max(narrationDurationSec, scene.endTimeSeconds, 1)

  const runGenerate = async () => {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/api/production/videos/scene-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptId,
          startTimeSeconds: scene.startTimeSeconds,
          endTimeSeconds: scene.endTimeSeconds,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to generate prompt')
      const data = await res.json() as { prompt: string }
      onChange({ visualPrompt: data.prompt, generationMode: 'ai' })
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate prompt')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateClick = () => {
    if (scene.visualPrompt.trim()) {
      setConfirmReplace(true)
      return
    }
    void runGenerate()
  }

  return (
    <div className={`rounded-lg border p-3 space-y-3 ${hasOverlap ? 'border-destructive/60 bg-destructive/5' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">Scene {index + 1}</span>
          {scene.generationMode === 'ai' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">AI</span>
          )}
          {hasOverlap && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />Overlap
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => onMove('up')}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === total - 1} onClick={() => onMove('down')}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDuplicate} title="Duplicate scene">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete} title="Delete scene">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <DualRangeSlider
          min={0}
          max={sliderMax}
          step={1}
          value={[scene.startTimeSeconds, scene.endTimeSeconds]}
          onValueChange={([s, e]) => {
            onChange({ startTimeSeconds: s, endTimeSeconds: e })
            setStartInput(formatTime(s))
            setEndInput(formatTime(e))
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Start Time</Label>
          <Input
            data-scene-field={`start-${scene.id}`}
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
            onBlur={(e) => commitStart(e.target.value)}
            placeholder="00:00"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">End Time</Label>
          <Input
            data-scene-field={`end-${scene.id}`}
            value={endInput}
            onChange={(e) => setEndInput(e.target.value)}
            onBlur={(e) => commitEnd(e.target.value)}
            placeholder="00:08"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Duration</Label>
          <div className="h-8 flex items-center px-2 rounded-md border bg-muted text-sm font-mono text-muted-foreground">
            {duration > 0 ? `${duration}s` : '—'}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Visual Prompt</Label>
        <Textarea
          value={scene.visualPrompt}
          onChange={(e) => onChange({ visualPrompt: e.target.value })}
          placeholder="Describe the video footage, image, animation, or visual you want to display during this scene..."
          rows={2}
          className="text-sm"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px] space-y-1">
          <Label className="text-xs">Visual Type</Label>
          <Select value={scene.visualType} onValueChange={(v) => onChange({ visualType: v as EditorScene['visualType'] })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(VISUAL_TYPE_LABELS) as EditorScene['visualType'][]).map((t) => (
                <SelectItem key={t} value={t}>{VISUAL_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-1.5 pb-0.5">
          {confirmReplace ? (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Replace existing prompt?</span>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setConfirmReplace(false)}>Cancel</Button>
              <Button size="sm" className="h-7 px-2" onClick={() => { setConfirmReplace(false); void runGenerate() }}>Replace</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8" onClick={handleGenerateClick} disabled={generating || !scriptId}>
              {generating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              {scene.visualPrompt.trim() ? 'Regenerate Prompt' : 'Generate Prompt with AI'}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-8" onClick={onPreview}>
            <Play className="h-3.5 w-3.5 mr-1.5" />Preview
          </Button>
        </div>
      </div>
      {genError && <p className="text-xs text-destructive">{genError}</p>}
      {!scriptId && (
        <p className="text-xs text-muted-foreground">Link a script above to enable AI prompt generation.</p>
      )}
    </div>
  )
}

function CompleteTimeline({
  scenes,
  narrationDurationSec,
  selectedId,
  overlapIds,
  onSelect,
  onResize,
}: {
  scenes: EditorScene[]
  narrationDurationSec: number
  selectedId: string | null
  overlapIds: Set<string>
  onSelect: (id: string) => void
  onResize: (id: string, patch: Partial<EditorScene>) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const totalSec = Math.max(narrationDurationSec, ...scenes.map((s) => s.endTimeSeconds), 1)

  const dragRef = useRef<{ id: string; edge: 'left' | 'right'; startX: number; startVal: number } | null>(null)

  const secPerPx = (rectWidth: number) => totalSec / rectWidth

  const onPointerDown = (e: React.PointerEvent, id: string, edge: 'left' | 'right') => {
    e.stopPropagation()
    const scene = scenes.find((s) => s.id === id)
    if (!scene) return
    dragRef.current = {
      id,
      edge,
      startX: e.clientX,
      startVal: edge === 'left' ? scene.startTimeSeconds : scene.endTimeSeconds,
    }
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current || !trackRef.current) return
      const rect = trackRef.current.getBoundingClientRect()
      const deltaPx = ev.clientX - dragRef.current.startX
      const deltaSec = Math.round(deltaPx * secPerPx(rect.width))
      const nextVal = dragRef.current.startVal + deltaSec
      if (dragRef.current.edge === 'left') {
        const clamped = Math.max(0, Math.min(nextVal, scene.endTimeSeconds - 1))
        onResize(id, { startTimeSeconds: clamped })
      } else {
        const clamped = Math.max(scene.startTimeSeconds + 1, Math.min(nextVal, narrationDurationSec > 0 ? narrationDurationSec : nextVal))
        onResize(id, { endTimeSeconds: clamped })
      }
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>00:00</span>
        <span>{formatTime(totalSec)}</span>
      </div>
      <div ref={trackRef} className="relative h-12 rounded-md bg-muted overflow-hidden">
        {scenes.map((s) => {
          const left = (s.startTimeSeconds / totalSec) * 100
          const width = ((s.endTimeSeconds - s.startTimeSeconds) / totalSec) * 100
          const isSelected = s.id === selectedId
          const isOverlap = overlapIds.has(s.id)
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`absolute top-0.5 bottom-0.5 rounded border flex items-center justify-center text-[10px] font-medium cursor-pointer select-none overflow-hidden px-1 ${
                isOverlap
                  ? 'bg-destructive/20 border-destructive text-destructive'
                  : isSelected
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'bg-primary/10 border-primary/30 text-foreground/70 hover:bg-primary/15'
              }`}
              style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
              title={`Scene ${scenes.indexOf(s) + 1}: ${formatTime(s.startTimeSeconds)}–${formatTime(s.endTimeSeconds)}`}
            >
              <span
                onPointerDown={(e) => onPointerDown(e, s.id, 'left')}
                className="absolute left-0 inset-y-0 w-1.5 cursor-ew-resize"
              />
              <span className="truncate">{scenes.indexOf(s) + 1} · {s.endTimeSeconds - s.startTimeSeconds}s</span>
              <span
                onPointerDown={(e) => onPointerDown(e, s.id, 'right')}
                className="absolute right-0 inset-y-0 w-1.5 cursor-ew-resize"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SceneTimelineEditor({
  scenes,
  onChange,
  narrationDurationSec,
  narrationAudioUrl,
  scriptId,
}: {
  scenes: EditorScene[]
  onChange: (scenes: EditorScene[]) => void
  narrationDurationSec: number
  narrationAudioUrl?: string
  scriptId?: string
}) {
  const [mode, setMode] = useState<'manual' | 'ai'>('manual')
  const [selectedId, setSelectedId] = useState<string | null>(scenes[0]?.id ?? null)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playhead, setPlayhead] = useState(0)

  const validation = useMemo(() => validateScenes(scenes, narrationDurationSec), [scenes, narrationDurationSec])

  const update = (id: string, patch: Partial<EditorScene>) => {
    onChange(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const addScene = () => {
    const lastEnd = scenes.length > 0 ? Math.max(...scenes.map((s) => s.endTimeSeconds)) : 0
    const defaultLen = 5
    const start = Math.min(lastEnd, Math.max(0, narrationDurationSec - defaultLen))
    const end = narrationDurationSec > 0 ? Math.min(start + defaultLen, narrationDurationSec) : start + defaultLen
    const scene = newScene(start, end)
    onChange([...scenes, scene])
    setSelectedId(scene.id)
  }

  const duplicateScene = (id: string) => {
    const s = scenes.find((x) => x.id === id)
    if (!s) return
    const idx = scenes.indexOf(s)
    const copy: EditorScene = { ...s, id: crypto.randomUUID() }
    const next = [...scenes]
    next.splice(idx + 1, 0, copy)
    onChange(next)
  }

  const deleteScene = (id: string) => {
    if (!confirm('Delete this scene?')) return
    onChange(scenes.filter((s) => s.id !== id))
  }

  const moveScene = (id: string, direction: 'up' | 'down') => {
    const idx = scenes.findIndex((s) => s.id === id)
    if (idx < 0) return
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= scenes.length) return
    const next = [...scenes]
    ;[next[idx], next[swapWith]] = [next[swapWith]!, next[idx]!]
    onChange(next)
  }

  const previewScene = (s: EditorScene) => {
    if (!audioRef.current || !narrationAudioUrl) return
    audioRef.current.currentTime = s.startTimeSeconds
    void audioRef.current.play()
    const stopAt = s.endTimeSeconds
    const onTime = () => {
      if (audioRef.current && audioRef.current.currentTime >= stopAt) {
        audioRef.current.pause()
        audioRef.current.removeEventListener('timeupdate', onTime)
      }
    }
    audioRef.current.addEventListener('timeupdate', onTime)
  }

  const runAiGenerate = async () => {
    if (!scriptId) {
      setAiError('Link a script above to auto-generate scenes.')
      return
    }
    setAiGenerating(true)
    setAiError(null)
    try {
      const res = await fetch('/api/production/videos/scenes-from-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to generate scenes')
      const data = await res.json() as { scenes: Array<{ scene_index: number; prompt: string; duration_sec: number }> }
      let cursor = 0
      const generated: EditorScene[] = data.scenes
        .sort((a, b) => a.scene_index - b.scene_index)
        .map((s) => {
          const start = cursor
          const end = cursor + s.duration_sec
          cursor = end
          return {
            id: crypto.randomUUID(),
            startTimeSeconds: start,
            endTimeSeconds: end,
            visualPrompt: s.prompt,
            visualType: 'auto' as const,
            generationMode: 'ai' as const,
          }
        })
      onChange(generated)
      setSelectedId(generated[0]?.id ?? null)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to generate scenes')
    } finally {
      setAiGenerating(false)
    }
  }

  return (
    <div className="space-y-3">
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'manual' | 'ai')}>
        <TabsList>
          <TabsTrigger value="manual">Manual Timeline Editor</TabsTrigger>
          <TabsTrigger value="ai">AI Generate Scenes</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === 'ai' && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void runAiGenerate()} disabled={aiGenerating || !scriptId}>
            {aiGenerating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {aiGenerating ? 'Analyzing script…' : scenes.length > 0 ? 'Regenerate Scenes from Script' : 'Generate Scenes from Script'}
          </Button>
          {!scriptId && <p className="text-xs text-muted-foreground">Link a script above first.</p>}
        </div>
      )}
      {aiError && <p className="text-xs text-destructive">{aiError}</p>}

      {narrationAudioUrl && <audio ref={audioRef} src={narrationAudioUrl} className="hidden" onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)} />}

      {scenes.length > 0 && (
        <>
          <CompleteTimeline
            scenes={scenes}
            narrationDurationSec={narrationDurationSec}
            selectedId={selectedId}
            overlapIds={validation.overlapIds}
            onSelect={setSelectedId}
            onResize={update}
          />
          {narrationAudioUrl && (
            <p className="text-xs text-muted-foreground font-mono">Playhead: {formatTime(playhead)}</p>
          )}

          <div className="rounded-md border p-2.5 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Timeline Coverage</span>
              <span className="font-medium">
                {formatTime(validation.coverageSec)} / {formatTime(narrationDurationSec)} ({Math.round(validation.coveragePct)}%)
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${validation.coveragePct}%` }} />
            </div>
            {validation.warnings.map((w, i) => (
              <p key={i} className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="h-3 w-3 shrink-0" />{w}
              </p>
            ))}
            {validation.errors.length === 0 && validation.warnings.length === 0 && (
              <p className="flex items-center gap-1.5 text-green-600">
                <CheckCircle2 className="h-3 w-3 shrink-0" />Complete narration coverage, no conflicts.
              </p>
            )}
            {[...new Set(validation.errors)].map((e, i) => (
              <p key={i} className="flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0" />{e}
              </p>
            ))}
          </div>
        </>
      )}

      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {scenes.map((s, i) => (
          <div key={s.id} onClick={() => setSelectedId(s.id)}>
            <SceneCard
              scene={s}
              index={i}
              total={scenes.length}
              narrationDurationSec={narrationDurationSec}
              hasOverlap={validation.overlapIds.has(s.id)}
              scriptId={scriptId}
              onChange={(patch) => update(s.id, patch)}
              onDuplicate={() => duplicateScene(s.id)}
              onDelete={() => deleteScene(s.id)}
              onMove={(dir) => moveScene(s.id, dir)}
              onPreview={() => previewScene(s)}
            />
          </div>
        ))}
      </div>

      {mode === 'manual' && (
        <Button type="button" variant="outline" size="sm" onClick={addScene}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />{scenes.length > 0 ? 'Add Another Scene' : 'Add Scene'}
        </Button>
      )}
    </div>
  )
}

export { formatTime, parseTime, validateScenes }
