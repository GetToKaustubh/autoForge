'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useActiveChannel } from '@/hooks/use-channel'
import { Mic, Play, Pause, Loader2, Plus, CheckCircle, XCircle, Clock, Trash2, ChevronDown } from 'lucide-react'

interface VoiceGeneration {
  id: string
  scriptId: string
  voiceId: string
  voiceName: string | null
  voiceSettings: { stability: number; similarityBoost: number; style: number; useSpeakerBoost: boolean; pace?: 'slow' | 'normal' | 'fast' }
  sections: Array<{ section_index: number; cloudinary_url: string; duration_sec: number; characters_used: number }>
  fullAudioUrl: string | null
  totalChars: number | null
  totalDurationSec: number | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  errorMessage: string | null
  createdAt: string
}

// Voice IDs must exist in Microsoft's current Edge TTS catalog (msedge-tts's
// getVoices()) - Microsoft periodically retires voices, and a stale id here
// makes every generation with that voice fail at the TTS call with no way
// to tell from the UI why. Confirmed live against the current catalog:
// DavisNeural, AmberNeural, and (non-multilingual) WilliamNeural are gone.
const POPULAR_VOICES = [
  { id: 'en-US-GuyNeural', name: 'Guy (Male, American)' },
  { id: 'en-US-EricNeural', name: 'Eric (Male, American)' },
  { id: 'en-US-AriaNeural', name: 'Aria (Female, American)' },
  { id: 'en-US-JennyNeural', name: 'Jenny (Female, American)' },
  { id: 'en-US-MichelleNeural', name: 'Michelle (Female, American)' },
  { id: 'en-GB-RyanNeural', name: 'Ryan (Male, British)' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (Female, British)' },
  { id: 'en-AU-WilliamMultilingualNeural', name: 'William (Male, Australian)' },
]

function StatusBadge({ status }: { status: VoiceGeneration['status'] }) {
  if (status === 'completed') return <Badge className="bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>
  if (status === 'failed') return <Badge className="bg-red-500/10 text-red-600 border-red-500/20"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>
  if (status === 'processing') return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>
  return <Badge className="bg-gray-500/10 text-gray-600 border-gray-500/20"><Clock className="w-3 h-3 mr-1" />Pending</Badge>
}

function AudioPlayer({ url, label }: { url: string; label: string }) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url)
      audioRef.current.onended = () => setPlaying(false)
    }
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current.play()
      setPlaying(true)
    }
  }

  return (
    <button onClick={toggle} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
      {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      {label}
    </button>
  )
}

function VoiceCard({ gen, onRefetch, onRemove }: { gen: VoiceGeneration; onRefetch: () => void; onRemove: (id: string) => void }) {
  const isActive = gen.status === 'pending' || gen.status === 'processing'

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(onRefetch, 5000)
    return () => clearInterval(interval)
  }, [isActive, onRefetch])

  const dur = gen.totalDurationSec ? `${Math.round(gen.totalDurationSec)}s` : null
  const chars = gen.totalChars ? `${gen.totalChars.toLocaleString()} chars` : null
  const pace = gen.voiceSettings?.pace && gen.voiceSettings.pace !== 'normal'
    ? gen.voiceSettings.pace[0]!.toUpperCase() + gen.voiceSettings.pace.slice(1) + ' pace'
    : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{gen.voiceName ?? gen.voiceId}</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              {[dur, chars, pace].filter(Boolean).join(' · ') || 'Processing…'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={gen.status} />
            <button
              type="button"
              onClick={() => onRemove(gen.id)}
              className="text-muted-foreground hover:text-destructive"
              title="Remove voice generation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {gen.status === 'completed' && gen.fullAudioUrl && (
          <AudioPlayer url={gen.fullAudioUrl} label="Play full audio" />
        )}
        {gen.sections.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Sections</p>
            <div className="grid grid-cols-2 gap-1">
              {gen.sections.map((s) => (
                <AudioPlayer
                  key={s.section_index}
                  url={s.cloudinary_url}
                  label={`Section ${s.section_index + 1} (${Math.round(s.duration_sec)}s)`}
                />
              ))}
            </div>
          </div>
        )}
        {gen.status === 'failed' && gen.errorMessage && (
          <p className="text-sm text-destructive">{gen.errorMessage}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {new Date(gen.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </CardContent>
    </Card>
  )
}

// Custom dropdown (not the shadcn Select) because each row needs its own
// clickable preview button nested inside a selectable row - Radix Select's
// SelectItem hit-tests the whole row on pointerdown, which swallows clicks
// on nested interactive children before they can reach a button's own
// handler, making a real inline "preview without selecting" control
// unreliable inside it.
function VoicePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const selected = POPULAR_VOICES.find((v) => v.id === value)

  const stopPreview = () => {
    audioRef.current?.pause()
    setPreviewingId(null)
  }

  const togglePreview = (voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (previewingId === voiceId) {
      stopPreview()
      return
    }
    audioRef.current?.pause()
    setLoadingId(voiceId)
    const audio = new Audio(`/api/production/voice/preview?voiceId=${encodeURIComponent(voiceId)}`)
    audioRef.current = audio
    audio.onended = () => setPreviewingId((cur) => (cur === voiceId ? null : cur))
    audio.oncanplay = () => {
      setLoadingId((cur) => (cur === voiceId ? null : cur))
      setPreviewingId(voiceId)
      void audio.play()
    }
    audio.onerror = () => {
      setLoadingId((cur) => (cur === voiceId ? null : cur))
      setPreviewingId((cur) => (cur === voiceId ? null : cur))
    }
  }

  useEffect(() => {
    return () => audioRef.current?.pause()
  }, [])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <span>{selected?.name ?? 'Select a voice'}</span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-72 overflow-y-auto">
            {POPULAR_VOICES.map((v) => (
              <div
                key={v.id}
                onClick={() => { onChange(v.id); setOpen(false) }}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent ${v.id === value ? 'bg-accent/50 font-medium' : ''}`}
              >
                <button
                  type="button"
                  onClick={(e) => togglePreview(v.id, e)}
                  title={previewingId === v.id ? 'Stop preview' : 'Preview voice'}
                  className="shrink-0 h-6 w-6 flex items-center justify-center rounded-full border hover:bg-background"
                >
                  {loadingId === v.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : previewingId === v.id ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </button>
                <span className="flex-1">{v.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function GenerateVoiceDialog({ scripts }: { scripts: Array<{ id: string; title: string }> }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [scriptId, setScriptId] = useState('')
  const [voiceId, setVoiceId] = useState(POPULAR_VOICES[0]!.id)
  const [pace, setPace] = useState<'slow' | 'normal' | 'fast'>('normal')

  const channelId = useActiveChannel()?.id ?? ''

  const mutation = useMutation({
    mutationFn: async () => {
      const selectedVoice = POPULAR_VOICES.find((v) => v.id === voiceId)
      const res = await fetch('/api/production/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptId,
          channelId,
          voiceId,
          voiceName: selectedVoice?.name,
          pace,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to start voice generation')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-generations'] })
      setOpen(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" />Generate Voice</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Voice Audio</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Script</Label>
            <Select value={scriptId} onValueChange={setScriptId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a script" />
              </SelectTrigger>
              <SelectContent>
                {scripts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Voice</Label>
            <VoicePicker value={voiceId} onChange={setVoiceId} />
            <p className="text-xs text-muted-foreground">Click the play icon next to a voice to preview it before generating.</p>
          </div>

          <div className="space-y-2">
            <Label>Pace</Label>
            <Select value={pace} onValueChange={(v) => setPace(v as 'slow' | 'normal' | 'fast')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slow">Slow</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="fast">Fast</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}

          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!scriptId || !voiceId || !channelId || mutation.isPending}
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
            ) : (
              <><Mic className="w-4 h-4 mr-2" />Generate</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function VoicePage() {
  const activeChannel = useActiveChannel()
  const queryClient = useQueryClient()

  const { data, refetch } = useQuery({
    queryKey: ['voice-generations', activeChannel?.id],
    queryFn: async () => {
      const res = await fetch('/api/production/voice')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ voiceGenerations: VoiceGeneration[] }>
    },
    enabled: !!activeChannel,
    staleTime: 10_000,
  })

  const { data: scriptsData } = useQuery({
    queryKey: ['scripts-for-voice', activeChannel?.id],
    queryFn: async () => {
      const res = await fetch(`/api/content/scripts?channelId=${activeChannel!.id}&limit=50&activeIdeaOnly=true&status=approved`)
      if (!res.ok) throw new Error('Failed to fetch scripts')
      return res.json() as Promise<{ scripts: Array<{ id: string; title: string }> }>
    },
    enabled: !!activeChannel,
  })

  const { mutate: removeGeneration, error: removeError } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/production/voice/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to remove voice generation')
      return res.json()
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['voice-generations'] }),
  })

  const generations = data?.voiceGenerations ?? []
  const scripts = scriptsData?.scripts ?? []

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Mic className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">No channel selected</h2>
        <p className="text-muted-foreground mt-2">Select a YouTube channel to view voice generations.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Voice Generation</h1>
          <p className="text-muted-foreground text-sm mt-1">Convert scripts to AI voice audio via Microsoft Edge TTS</p>
        </div>
        <GenerateVoiceDialog scripts={scripts} />
      </div>

      {removeError && (
        <p className="text-sm text-destructive">{(removeError as Error).message}</p>
      )}

      {generations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-xl">
          <Mic className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-medium">No voice generations yet</p>
          <p className="text-sm text-muted-foreground mt-1">Generate voice audio from an approved script.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {generations.map((gen) => (
            <VoiceCard
              key={gen.id}
              gen={gen}
              onRefetch={refetch}
              onRemove={(id) => { if (confirm('Remove this voice generation?')) removeGeneration(id) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
