'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useActiveChannel } from '@/hooks/use-channel'
import { Upload, Calendar, Loader2, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

interface VideoForUpload {
  id: string
  title: string
  ytTitle: string | null
  ytDescription: string | null
  ytTags: string[] | null
  pipelineStage: string
  finalVideoUrl: string | null
}

interface ScheduledUpload {
  id: string
  videoId: string
  scheduledAt: string
  timezone: string
  status: 'scheduled' | 'uploading' | 'uploaded' | 'failed' | 'cancelled'
  attemptCount: number
  lastError: string | null
  createdAt: string
}

function ScheduleCard({ schedule, videoTitle, onCancel }: {
  schedule: ScheduledUpload
  videoTitle: string
  onCancel: (id: string) => void
}) {
  const statusIcon = {
    scheduled: <Clock className="w-4 h-4 text-blue-500" />,
    uploading: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
    uploaded: <CheckCircle className="w-4 h-4 text-green-500" />,
    failed: <AlertTriangle className="w-4 h-4 text-red-500" />,
    cancelled: <span className="w-4 h-4 text-gray-400">×</span>,
  }

  const canCancel = schedule.status === 'scheduled'
  const scheduledDate = new Date(schedule.scheduledAt)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          {statusIcon[schedule.status]}
          <CardTitle className="text-sm truncate flex-1">{videoTitle}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm">
          <span className="text-muted-foreground">Scheduled: </span>
          <span className="font-medium">{scheduledDate.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}</span>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Status: </span>
          <span className="capitalize font-medium">{schedule.status}</span>
          {schedule.attemptCount > 0 && <span className="text-muted-foreground"> ({schedule.attemptCount} attempt{schedule.attemptCount > 1 ? 's' : ''})</span>}
        </div>
        {schedule.lastError && (
          <p className="text-xs text-destructive">{schedule.lastError}</p>
        )}
        {canCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCancel(schedule.id)}
            className="text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function UploadNowDialog({ videos, channelId }: { videos: VideoForUpload[]; channelId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [videoId, setVideoId] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private' | 'unlisted'>('private')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [madeForKids, setMadeForKids] = useState(false)

  const readyVideos = videos.filter((v) =>
    ['rendered', 'seo_optimized', 'scheduled'].includes(v.pipelineStage) && v.finalVideoUrl
  )

  const handleVideoChange = (id: string) => {
    setVideoId(id)
    const v = videos.find((v) => v.id === id)
    if (v) {
      setTitle(v.ytTitle ?? v.title)
      setDescription(v.ytDescription ?? '')
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/publishing/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          channelId,
          ytTitle: title || undefined,
          ytDescription: description || undefined,
          ytVisibility: visibility,
          ytMadeForKids: madeForKids,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to start upload')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] })
      setOpen(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Upload className="w-4 h-4 mr-2" />Upload Now</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload to YouTube</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex gap-2 text-sm text-yellow-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Each upload costs 1,600 YouTube API quota units (max 6/day per GCP project).</span>
          </div>

          <div className="space-y-2">
            <Label>Video *</Label>
            <Select value={videoId} onValueChange={handleVideoChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a rendered video" />
              </SelectTrigger>
              <SelectContent>
                {readyVideos.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.ytTitle ?? v.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {readyVideos.length === 0 && (
              <p className="text-xs text-muted-foreground">No rendered videos ready for upload.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              placeholder="Video title (max 100 chars)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Video description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
            />
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (recommended — review first)</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Made for Kids</Label>
              <p className="text-xs text-muted-foreground">Required by YouTube COPPA policy</p>
            </div>
            <Switch checked={madeForKids} onCheckedChange={setMadeForKids} />
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}

          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!videoId || !title || mutation.isPending}
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting upload…</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />Start Upload</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleDialog({ videos, channelId }: { videos: VideoForUpload[]; channelId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [videoId, setVideoId] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')

  const readyVideos = videos.filter((v) =>
    ['rendered', 'seo_optimized'].includes(v.pipelineStage) && v.finalVideoUrl
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/publishing/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          channelId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to schedule')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      setOpen(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Calendar className="w-4 h-4 mr-2" />Schedule Upload</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule Upload</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Video *</Label>
            <Select value={videoId} onValueChange={setVideoId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a video" />
              </SelectTrigger>
              <SelectContent>
                {readyVideos.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.ytTitle ?? v.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Scheduled Date & Time *</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            />
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}

          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!videoId || !scheduledAt || mutation.isPending}
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scheduling…</>
            ) : (
              <><Calendar className="w-4 h-4 mr-2" />Schedule</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function UploadPage() {
  const queryClient = useQueryClient()
  const activeChannel = useActiveChannel()

  const { data: videosData } = useQuery({
    queryKey: ['videos', activeChannel?.id],
    queryFn: async () => {
      const res = await fetch(`/api/production/videos?channelId=${activeChannel!.id}&limit=50`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ videos: VideoForUpload[] }>
    },
    enabled: !!activeChannel,
  })

  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', activeChannel?.id],
    queryFn: async () => {
      const res = await fetch(`/api/publishing/schedule?channelId=${activeChannel!.id}&limit=20`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ schedules: ScheduledUpload[] }>
    },
    enabled: !!activeChannel,
  })

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/publishing/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
  })

  const videos = videosData?.videos ?? []
  const schedules = schedulesData?.schedules ?? []
  const videoMap = Object.fromEntries(videos.map((v) => [v.id, v]))

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Upload className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">No channel selected</h2>
        <p className="text-muted-foreground mt-2">Select a YouTube channel to upload videos.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Upload to YouTube</h1>
          <p className="text-muted-foreground text-sm mt-1">Upload immediately or schedule for later</p>
        </div>
        <div className="flex gap-2">
          <ScheduleDialog videos={videos} channelId={activeChannel.id} />
          <UploadNowDialog videos={videos} channelId={activeChannel.id} />
        </div>
      </div>

      {/* Quota warning */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex gap-3">
          <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">YouTube API Quota</p>
            <p className="text-sm text-blue-700">Each upload costs 1,600 quota units. With a daily limit of 10,000 units per GCP project, you can upload up to 6 videos per day.</p>
          </div>
        </div>
      </div>

      {/* Scheduled Uploads */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Scheduled Uploads</h2>
        {schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl">
            <Calendar className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No scheduled uploads</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {schedules.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                videoTitle={videoMap[s.videoId]?.ytTitle ?? videoMap[s.videoId]?.title ?? 'Unknown video'}
                onCancel={(id) => cancelMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
