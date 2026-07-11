'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useChannel } from '@/hooks/use-channel'

export default function ChannelSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const channelId = params.channelId as string

  const { data: channel, isLoading } = useChannel(channelId)

  const [form, setForm] = useState({
    defaultCategory: '',
    language: '',
    defaultTags: '',
  })
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (channel) {
      setForm({
        defaultCategory: channel.defaultCategory ?? '',
        language: channel.language ?? '',
        defaultTags: channel.defaultTags?.join(', ') ?? '',
      })
    }
  }, [channel])

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
