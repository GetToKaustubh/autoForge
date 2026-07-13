'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Youtube, Settings, BarChart2, AlertTriangle, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useChannelStore } from '@/stores/channel-store'
import { cn } from '@/lib/utils/cn'

interface Channel {
  id: string
  ytChannelId: string
  channelName: string
  channelHandle: string | null
  channelThumbnail: string | null
  subscriberCount: number | null
  videoCount: number | null
  quotaUsedToday: number
  quotaLimitDaily: number
  status: string
  isPrimary: boolean
}

const statusConfig = {
  active: { label: 'Active', icon: CheckCircle, color: 'text-green-500' },
  suspended: { label: 'Suspended', icon: AlertTriangle, color: 'text-yellow-500' },
  disconnected: { label: 'Disconnected', icon: AlertTriangle, color: 'text-red-500' },
  quota_exceeded: { label: 'Quota Exceeded', icon: AlertTriangle, color: 'text-red-500' },
} as const

export function ChannelCard({ channel }: { channel: Channel }) {
  const router = useRouter()
  const { activeChannel, setActiveChannel } = useChannelStore()
  const isActive = activeChannel?.id === channel.id
  const quotaPercent = Math.round((channel.quotaUsedToday / channel.quotaLimitDaily) * 100)
  const status = statusConfig[channel.status as keyof typeof statusConfig] ?? statusConfig.active
  const StatusIcon = status.icon

  const formatCount = (n: number | null) => {
    if (!n) return '0'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toString()
  }

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        isActive && 'ring-2 ring-primary ring-offset-2'
      )}
      onClick={() => {
        setActiveChannel({
          id: channel.id,
          ytChannelId: channel.ytChannelId,
          channelName: channel.channelName,
          channelHandle: channel.channelHandle,
          channelThumbnail: channel.channelThumbnail,
          subscriberCount: channel.subscriberCount ?? 0,
          quotaUsedToday: channel.quotaUsedToday,
          quotaLimitDaily: channel.quotaLimitDaily,
          status: channel.status,
        })
        router.push(`/channels/${channel.id}`)
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {channel.channelThumbnail ? (
            <img
              src={channel.channelThumbnail}
              alt={channel.channelName}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Youtube className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{channel.channelName}</h3>
              {channel.isPrimary && (
                <Badge variant="secondary" className="text-xs">Primary</Badge>
              )}
              {isActive && (
                <Badge className="text-xs">Active</Badge>
              )}
            </div>
            {channel.channelHandle && (
              <p className="text-sm text-muted-foreground truncate">{channel.channelHandle}</p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Stats */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {formatCount(channel.subscriberCount)} subscribers
          </span>
          <span className="text-muted-foreground">
            {formatCount(channel.videoCount)} videos
          </span>
        </div>

        {/* Status */}
        <div className={cn('flex items-center gap-1.5 text-sm', status.color)}>
          <StatusIcon className="h-3.5 w-3.5" />
          <span>{status.label}</span>
        </div>

        {/* Quota */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>API Quota</span>
            <span>{channel.quotaUsedToday.toLocaleString()} / {channel.quotaLimitDaily.toLocaleString()} units</span>
          </div>
          <Progress
            value={quotaPercent}
            className={cn(
              'h-1.5',
              quotaPercent >= 90 && '[&>div]:bg-red-500',
              quotaPercent >= 70 && quotaPercent < 90 && '[&>div]:bg-yellow-500'
            )}
          />
        </div>
      </CardContent>

      <CardFooter className="gap-2 pt-0">
        <Button variant="outline" size="sm" asChild onClick={(e) => e.stopPropagation()}>
          <Link href={`/analytics?channelId=${channel.id}`}>
            <BarChart2 className="mr-1.5 h-3.5 w-3.5" />
            Analytics
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild onClick={(e) => e.stopPropagation()}>
          <Link href={`/channels/${channel.id}/settings`}>
            <Settings className="mr-1.5 h-3.5 w-3.5" />
            Settings
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
