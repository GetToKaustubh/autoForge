'use client'

import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useActiveChannel } from '@/hooks/use-channel'
import { History, ExternalLink, Eye, ThumbsUp, Clock } from 'lucide-react'

interface PublishedVideo {
  id: string
  title: string
  ytTitle: string | null
  ytVideoId: string | null
  ytUrl: string | null
  ytVisibility: 'public' | 'private' | 'unlisted'
  pipelineStage: string
  durationSec: number | null
  uploadedAt: string | null
  publishedAt: string | null
  createdAt: string
}

function VisibilityBadge({ visibility }: { visibility: PublishedVideo['ytVisibility'] }) {
  const map = {
    public: 'bg-green-100 text-green-700',
    private: 'bg-gray-100 text-gray-600',
    unlisted: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${map[visibility]}`}>
      {visibility}
    </span>
  )
}

function VideoRow({ video }: { video: PublishedVideo }) {
  const uploadDate = video.uploadedAt ? new Date(video.uploadedAt) : null
  const dur = video.durationSec
    ? `${Math.floor(video.durationSec / 60)}:${String(Math.round(video.durationSec % 60)).padStart(2, '0')}`
    : null

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm truncate">{video.ytTitle ?? video.title}</CardTitle>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <VisibilityBadge visibility={video.ytVisibility} />
            <Badge variant="outline" className="text-xs capitalize">{video.pipelineStage.replace(/_/g, ' ')}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          {dur && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {dur}
            </span>
          )}
          {uploadDate && (
            <span>
              Uploaded {uploadDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
          {video.ytVideoId && (
            <a
              href={`https://youtube.com/watch?v=${video.ytVideoId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-red-600 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on YouTube
            </a>
          )}
          {video.ytVideoId && (
            <a
              href={`https://studio.youtube.com/video/${video.ytVideoId}/analytics`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <Eye className="w-3.5 h-3.5" />
              Analytics
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function HistoryPage() {
  const activeChannel = useActiveChannel()

  const { data, isLoading } = useQuery({
    queryKey: ['upload-history', activeChannel?.id],
    queryFn: async () => {
      const params = new URLSearchParams({
        channelId: activeChannel!.id,
        limit: '50',
      })
      const res = await fetch(`/api/production/videos?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ videos: PublishedVideo[] }>
    },
    enabled: !!activeChannel,
    staleTime: 60_000,
  })

  const allVideos = data?.videos ?? []
  const uploaded = allVideos.filter((v) =>
    ['uploaded', 'published', 'scheduled'].includes(v.pipelineStage)
  )

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <History className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">No channel selected</h2>
        <p className="text-muted-foreground mt-2">Select a YouTube channel to view upload history.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Upload History</h1>
        <p className="text-muted-foreground text-sm mt-1">All videos uploaded to {activeChannel.channelName}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <ThumbsUp className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{uploaded.filter((v) => v.pipelineStage === 'published').length}</p>
              <p className="text-xs text-muted-foreground">Published</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{uploaded.filter((v) => v.pipelineStage === 'scheduled').length}</p>
              <p className="text-xs text-muted-foreground">Scheduled</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <History className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{uploaded.length}</p>
              <p className="text-xs text-muted-foreground">Total Uploaded</p>
            </div>
          </div>
        </Card>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading history…</div>
      ) : uploaded.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-xl">
          <History className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-medium">No uploads yet</p>
          <p className="text-sm text-muted-foreground mt-1">Videos you upload to YouTube will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {uploaded.map((v) => (
            <VideoRow key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  )
}
