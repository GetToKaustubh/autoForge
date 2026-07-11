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
import { Slider } from '@/components/ui/slider'
import { useActiveChannel } from '@/hooks/use-channel'
import { Mic, Play, Pause, Loader2, Plus, CheckCircle, XCircle, Clock } from 'lucide-react'

interface VoiceGeneration {
  id: string
  scriptId: string
  voiceId: string
  voiceName: string | null
  voiceSettings: { stability: number; similarityBoost: number; style: number; useSpeakerBoost: boolean }
  sections: Array<{ section_index: number; cloudinary_url: string; duration_sec: number; characters_used: number }>
  fullAudioUrl: string | null
  totalChars: number | null
  totalDurationSec: number | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  errorMessage: string | null
  createdAt: string
}

const POPULAR_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Female, American)' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Female, American)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Female, American)' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Male, American)' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (Male, American)' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Male, American)' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam (Male, American)' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Female, American)' },
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

function VoiceCard({ gen, onRefetch }: { gen: VoiceGeneration; onRefetch: () => void }) {
  const isActive = gen.status === 'pending' || gen.status === 'processing'

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(onRefetch, 5000)
    return () => clearInterval(interval)
  }, [isActive, onRefetch])

  const dur = gen.totalDurationSec ? `${Math.round(gen.totalDurationSec)}s` : null
  const chars = gen.totalChars ? `${gen.totalChars.toLocaleString()} chars` : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{gen.voiceName ?? gen.voiceId}</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              {[dur, chars].filter(Boolean).join(' · ') || 'Processing…'}
            </p>
          </div>
          <StatusBadge status={gen.status} />
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

function GenerateVoiceDialog({ scripts }: { scripts: Array<{ id: string; title: string }> }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [scriptId, setScriptId] = useState('')
  const [voiceId, setVoiceId] = useState(POPULAR_VOICES[0]!.id)
  const [stability, setStability] = useState(0.5)
  const [similarityBoost, setSimilarityBoost] = useState(0.75)

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
          voiceSettings: { stability, similarityBoost, style: 0, useSpeakerBoost: true },
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
            <Select value={voiceId} onValueChange={setVoiceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POPULAR_VOICES.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Stability — {Math.round(stability * 100)}%</Label>
            <Slider
              min={0} max={1} step={0.05}
              value={[stability]}
              onValueChange={([v]) => setStability(v ?? 0.5)}
            />
            <p className="text-xs text-muted-foreground">Higher = more consistent, lower = more expressive</p>
          </div>

          <div className="space-y-2">
            <Label>Similarity Boost — {Math.round(similarityBoost * 100)}%</Label>
            <Slider
              min={0} max={1} step={0.05}
              value={[similarityBoost]}
              onValueChange={([v]) => setSimilarityBoost(v ?? 0.75)}
            />
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
      const res = await fetch(`/api/content/scripts?channelId=${activeChannel!.id}&limit=50`)
      if (!res.ok) throw new Error('Failed to fetch scripts')
      return res.json() as Promise<{ scripts: Array<{ id: string; title: string }> }>
    },
    enabled: !!activeChannel,
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
          <p className="text-muted-foreground text-sm mt-1">Convert scripts to AI voice audio via ElevenLabs</p>
        </div>
        <GenerateVoiceDialog scripts={scripts} />
      </div>

      {generations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-xl">
          <Mic className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-medium">No voice generations yet</p>
          <p className="text-sm text-muted-foreground mt-1">Generate voice audio from an approved script.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {generations.map((gen) => (
            <VoiceCard key={gen.id} gen={gen} onRefetch={refetch} />
          ))}
        </div>
      )}
    </div>
  )
}
