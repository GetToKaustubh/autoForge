'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Trash2, AlertTriangle, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useChannel, useAutopilotRuns, useAutopilotToggle, useAutopilotRunNow, type AutopilotRun } from '@/hooks/use-channel'

export default function ChannelSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const channelId = params.channelId as string

  const { data: channel, isLoading } = useChannel(channelId)
  const { data: autopilotRuns } = useAutopilotRuns(channelId)
  const autopilotToggle = useAutopilotToggle(channelId)
  const autopilotRunNow = useAutopilotRunNow(channelId)

  const [form, setForm] = useState({
    defaultCategory: '',
    language: '',
    defaultTags: '',
  })
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [autopilotForm, setAutopilotForm] = useState({
    enabled: false,
    nichePrompt: '',
    provider: 'stock',
    mode: 'review',
    scheduleHourUtc: 9,
    targetAudience: '',
    format: '',
  })
  const [veoConfirmOpen, setVeoConfirmOpen] = useState(false)

  useEffect(() => {
    if (channel) {
      setForm({
        defaultCategory: channel.defaultCategory ?? '',
        language: channel.language ?? '',
        defaultTags: channel.defaultTags?.join(', ') ?? '',
      })
      setAutopilotForm({
        enabled: channel.autopilotEnabled,
        nichePrompt: channel.autopilotNichePrompt ?? '',
        provider: channel.autopilotProvider,
        mode: channel.autopilotMode,
        scheduleHourUtc: channel.autopilotScheduleHourUtc,
        targetAudience: channel.autopilotTargetAudience ?? '',
        format: channel.autopilotFormat ?? '',
      })
    }
  }, [channel])

  async function handleSaveAutopilot() {
    try {
      await autopilotToggle.mutateAsync({
        enabled: autopilotForm.enabled,
        nichePrompt: autopilotForm.nichePrompt || undefined,
        provider: autopilotForm.provider,
        mode: autopilotForm.mode,
        scheduleHourUtc: autopilotForm.scheduleHourUtc,
        targetAudience: autopilotForm.targetAudience || undefined,
        format: autopilotForm.format || undefined,
      })
      toast.success(autopilotForm.enabled ? 'Autopilot enabled' : 'Autopilot disabled')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save autopilot settings')
    }
  }

  async function handleRunNow() {
    try {
      await autopilotRunNow.mutateAsync()
      toast.success('Autopilot run started — check the history below in a few minutes')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start autopilot run')
    }
  }

  function handleProviderChange(value: string) {
    if (value === 'veo' && autopilotForm.provider !== 'veo') {
      setVeoConfirmOpen(true)
      return
    }
    setAutopilotForm((f) => ({ ...f, provider: value }))
  }

  const runStatusVariant: Record<AutopilotRun['status'], 'default' | 'secondary' | 'destructive' | 'warning' | 'success'> = {
    running: 'secondary',
    completed: 'success',
    failed: 'destructive',
    skipped: 'secondary',
    awaiting_review: 'warning',
    discarded: 'secondary',
  }

  async function handleSave() {
    setSaving(true)
    try {
      const tags = form.defaultTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const res = await fetch(`/api/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultCategory: form.defaultCategory || undefined,
          language: form.language || undefined,
          defaultTags: tags.length > 0 ? tags : undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save settings')
      }

      toast.success('Settings saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/channels/${channelId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to disconnect channel')
      }
      toast.success('Channel disconnected')
      router.push('/channels')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Disconnect failed')
      setDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!channel) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Channel not found.</p>
        <Button asChild className="mt-4">
          <Link href="/channels">Back to Channels</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/channels/${channelId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Channel
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Channel Settings</h1>
        <p className="text-muted-foreground">
          Configure defaults for <strong>{channel.channelName}</strong>
        </p>
      </div>

      {/* Upload defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Defaults</CardTitle>
          <CardDescription>
            These values are pre-filled when uploading videos to this channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category">Default Category ID</Label>
            <Input
              id="category"
              placeholder="e.g. 22 (People & Blogs), 28 (Science & Technology)"
              value={form.defaultCategory}
              onChange={(e) => setForm((f) => ({ ...f, defaultCategory: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Common IDs: 22=People & Blogs, 24=Entertainment, 26=Howto & Style, 27=Education,
              28=Sci & Tech.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="language">Default Language</Label>
            <Input
              id="language"
              placeholder="e.g. en, es, fr"
              value={form.language}
              onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Default Tags</Label>
            <Input
              id="tags"
              placeholder="tag1, tag2, tag3"
              value={form.defaultTags}
              onChange={(e) => setForm((f) => ({ ...f, defaultTags: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Comma-separated. Max 20 tags.</p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving…' : 'Save Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Autopilot */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Autopilot</CardTitle>
              <CardDescription>
                Give it one niche/style prompt and it generates, produces, and{' '}
                {autopilotForm.mode === 'auto' ? 'publishes' : 'prepares for your review'} a new
                video on a schedule — no other manual steps.
              </CardDescription>
            </div>
            <Switch
              checked={autopilotForm.enabled}
              disabled={!autopilotForm.nichePrompt.trim() && !autopilotForm.enabled}
              onCheckedChange={(checked) => setAutopilotForm((f) => ({ ...f, enabled: checked }))}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="niche-prompt">Niche / Style Prompt</Label>
            <Textarea
              id="niche-prompt"
              placeholder="e.g. Short animated videos teaching kids the alphabet through talking fruit characters — playful, colorful, upbeat narration."
              rows={4}
              value={autopilotForm.nichePrompt}
              onChange={(e) => setAutopilotForm((f) => ({ ...f, nichePrompt: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              The only input autopilot needs. Be specific — this drives every idea, script, and
              visual it generates.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Visual Provider</Label>
              <Select value={autopilotForm.provider} onValueChange={handleProviderChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock Footage (free)</SelectItem>
                  <SelectItem value="ai-image">AI Images (free)</SelectItem>
                  <SelectItem value="runway">Runway (~$0.05-0.50/sec)</SelectItem>
                  <SelectItem value="pika">Pika (~$0.04/sec)</SelectItem>
                  <SelectItem value="veo">Veo 3.1 (~$0.05-0.08/sec, highest quality)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={autopilotForm.mode} onValueChange={(v) => setAutopilotForm((f) => ({ ...f, mode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Review — email me to approve first</SelectItem>
                  <SelectItem value="auto">Auto — publish immediately</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Run Time (UTC)</Label>
            <Select
              value={String(autopilotForm.scheduleHourUtc)}
              onValueChange={(v) => setAutopilotForm((f) => ({ ...f, scheduleHourUtc: Number(v) }))}
            >
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00 UTC</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              YouTube's daily quota (10,000 units per Google Cloud project, shared across every
              channel on it) caps this to roughly 6 uploads/day project-wide.
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSaveAutopilot} disabled={autopilotToggle.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {autopilotToggle.isPending ? 'Saving…' : 'Save Autopilot Settings'}
            </Button>
            <Button
              variant="outline"
              onClick={handleRunNow}
              disabled={autopilotRunNow.isPending || !autopilotForm.nichePrompt.trim()}
            >
              <Play className="mr-2 h-4 w-4" />
              {autopilotRunNow.isPending ? 'Starting…' : 'Run Once Now'}
            </Button>
          </div>

          {autopilotRuns && autopilotRuns.length > 0 && (
            <div className="space-y-2 pt-2">
              <Label>Recent Runs</Label>
              <div className="space-y-1.5">
                {autopilotRuns.map((run) => (
                  <div key={run.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={runStatusVariant[run.status]}>
                        {run.status === 'awaiting_review' ? 'Awaiting your approval' : run.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      {run.costUsd && Number(run.costUsd) > 0 && <span>${Number(run.costUsd).toFixed(2)}</span>}
                      {run.ytUrl && (
                        <a href={run.ytUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          View on YouTube
                        </a>
                      )}
                      {run.videoId && !run.ytUrl && (
                        <Link href={`/production/videos/${run.videoId}`} className="text-primary hover:underline">
                          View video
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={veoConfirmOpen} onOpenChange={setVeoConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to Veo 3.1?</DialogTitle>
            <DialogDescription>
              Veo costs real money on every autopilot run — roughly $0.05-0.08 per second of
              generated video, typically $2-6 per video depending on scene count. Unlike a manual
              generation, autopilot will keep spending this on every scheduled run with no
              per-run confirmation once enabled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVeoConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setAutopilotForm((f) => ({ ...f, provider: 'veo' }))
                setVeoConfirmOpen(false)
              }}
            >
              Use Veo 3.1
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Disconnecting removes this channel from TubeForge. Your YouTube channel is unaffected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-2 h-4 w-4" />
                Disconnect Channel
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Disconnect Channel?</DialogTitle>
                <DialogDescription>
                  This will revoke TubeForge's access to{' '}
                  <strong>{channel.channelName}</strong> and delete the encrypted OAuth tokens. All
                  scheduled uploads will be cancelled.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  Scheduled uploads, analytics sync, and automation for this channel will stop
                  immediately.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDisconnect} disabled={deleting}>
                  {deleting ? 'Disconnecting…' : 'Disconnect Channel'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  )
}
