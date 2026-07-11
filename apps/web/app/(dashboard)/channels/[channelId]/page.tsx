import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { organizations, organizationMembers, users, youtubeChannels } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import Image from 'next/image'
import Link from 'next/link'
import {
  Youtube,
  Users,
  PlayCircle,
  Eye,
  Globe,
  Settings,
  ExternalLink,
  ArrowLeft,
  TrendingUp,
  Upload,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ChannelSyncButton } from '@/components/channels/channel-sync-button'

function formatNumber(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

const STATUS_BADGE = {
  active: { label: 'Active', variant: 'default' as const },
  suspended: { label: 'Suspended', variant: 'destructive' as const },
  disconnected: { label: 'Disconnected', variant: 'outline' as const },
  quota_exceeded: { label: 'Quota Exceeded', variant: 'destructive' as const },
}

export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ channelId: string }>
}) {
  const { channelId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) notFound()

  const [member] = await db
    .select({ orgDbId: organizations.id })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.clerkOrgId, orgId), eq(users.clerkId, userId)))
    .limit(1)

  if (!member) notFound()

  const [channel] = await db
    .select()
    .from(youtubeChannels)
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        eq(youtubeChannels.organizationId, member.orgDbId),
        isNull(youtubeChannels.deletedAt)
      )
    )
    .limit(1)

  if (!channel) notFound()

  const quotaPercent = Math.round((channel.quotaUsedToday / channel.quotaLimitDaily) * 100)
  const quotaRemaining = channel.quotaLimitDaily - channel.quotaUsedToday
  const uploadsRemaining = Math.floor(quotaRemaining / 1600)
  const statusInfo = STATUS_BADGE[channel.status as keyof typeof STATUS_BADGE] ?? STATUS_BADGE.active

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/channels">
          <ArrowLeft className="mr-2 h-4 w-4" />
          All Channels
        </Link>
      </Button>

      {/* Channel header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {channel.channelThumbnail ? (
            <Image
              src={channel.channelThumbnail}
              alt={channel.channelName}
              width={80}
              height={80}
              className="rounded-full ring-2 ring-border"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted ring-2 ring-border">
              <Youtube className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{channel.channelName}</h1>
            {channel.channelHandle && (
              <p className="text-sm text-muted-foreground">{channel.channelHandle}</p>
            )}
            <div className="flex items-center gap-2">
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              {channel.isPrimary && <Badge variant="secondary">Primary</Badge>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <ChannelSyncButton channelId={channelId} />
          <Button asChild variant="outline" size="sm">
            <a
              href={`https://www.youtube.com/channel/${channel.ytChannelId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open on YouTube
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/channels/${channelId}/settings`}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/20">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Subscribers</p>
                <p className="text-2xl font-bold">{formatNumber(channel.subscriberCount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900/20">
                <PlayCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Videos</p>
                <p className="text-2xl font-bold">{formatNumber(channel.videoCount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-900/20">
                <Eye className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Views</p>
                <p className="text-2xl font-bold">{formatNumber(channel.viewCount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quota card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Daily API Quota
              </span>
              <span
                className={
                  quotaPercent >= 90
                    ? 'text-destructive'
                    : quotaPercent >= 70
                      ? 'text-yellow-500'
                      : 'text-green-600'
                }
              >
                {quotaPercent}%
              </span>
            </CardTitle>
            <CardDescription>YouTube Data API v3 — resets at midnight Pacific</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={quotaPercent}
              className={
                quotaPercent >= 90
                  ? '[&>div]:bg-destructive'
                  : quotaPercent >= 70
                    ? '[&>div]:bg-yellow-500'
                    : ''
              }
            />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Used today</p>
                <p className="font-semibold">
                  {channel.quotaUsedToday.toLocaleString()} /{' '}
                  {channel.quotaLimitDaily.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Remaining</p>
                <p className="font-semibold">{quotaRemaining.toLocaleString()} units</p>
              </div>
              <div>
                <p className="text-muted-foreground">Uploads remaining</p>
                <p className="font-semibold flex items-center gap-1">
                  <Upload className="h-3.5 w-3.5" />
                  {uploadsRemaining}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Per upload cost</p>
                <p className="font-semibold">1,600 units</p>
              </div>
            </div>

            {channel.status === 'quota_exceeded' && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>Quota exceeded. Uploads will resume after midnight Pacific Time.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channel info */}
        <Card>
          <CardHeader>
            <CardTitle>Channel Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {channel.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
                <p className="text-sm line-clamp-3">{channel.description}</p>
              </div>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-4 text-sm">
              {channel.country && (
                <div>
                  <p className="text-muted-foreground">Country</p>
                  <p className="font-medium flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5" />
                    {channel.country}
                  </p>
                </div>
              )}
              {channel.language && (
                <div>
                  <p className="text-muted-foreground">Language</p>
                  <p className="font-medium">{channel.language}</p>
                </div>
              )}
              {channel.defaultCategory && (
                <div>
                  <p className="text-muted-foreground">Default Category</p>
                  <p className="font-medium">{channel.defaultCategory}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Channel ID</p>
                <p className="font-mono text-xs truncate">{channel.ytChannelId}</p>
              </div>
            </div>

            {channel.defaultTags && channel.defaultTags.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Default Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {channel.defaultTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Manage content for this channel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Button asChild variant="outline" className="h-auto py-4 flex-col gap-2">
              <Link href={`/research?channelId=${channelId}`}>
                <TrendingUp className="h-5 w-5" />
                <span className="text-sm">Research Niches</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto py-4 flex-col gap-2">
              <Link href={`/content/ideas?channelId=${channelId}`}>
                <PlayCircle className="h-5 w-5" />
                <span className="text-sm">Generate Ideas</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto py-4 flex-col gap-2">
              <Link href={`/production?channelId=${channelId}`}>
                <Youtube className="h-5 w-5 text-youtube-red" />
                <span className="text-sm">Start Pipeline</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto py-4 flex-col gap-2">
              <Link href={`/analytics?channelId=${channelId}`}>
                <Eye className="h-5 w-5" />
                <span className="text-sm">View Analytics</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
