import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { organizations, youtubeChannels, videos, videoAnalytics } from '@/lib/db/schema'
import { eq, desc, count, sum } from 'drizzle-orm'
import { StatsCard } from '@/components/shared/stats-card'
import { Youtube, Video, TrendingUp, DollarSign } from 'lucide-react'

export const metadata = { title: 'Dashboard' }

export default async function DashboardOverviewPage() {
  const { orgId } = await auth()

  // Get org from DB
  const [org] = orgId
    ? await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, orgId))
        .limit(1)
    : [null]

  const channelCount = org
    ? await db
        .select({ count: count() })
        .from(youtubeChannels)
        .where(eq(youtubeChannels.organizationId, org.id))
        .then((r) => r[0]?.count ?? 0)
    : 0

  const videoCount = org
    ? await db
        .select({ count: count() })
        .from(videos)
        .where(eq(videos.organizationId, org.id))
        .then((r) => r[0]?.count ?? 0)
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here's an overview of your YouTube automation platform.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Connected Channels"
          value={channelCount.toString()}
          description="YouTube channels connected"
          icon={<Youtube className="h-4 w-4 text-muted-foreground" />}
        />
        <StatsCard
          title="Total Videos"
          value={videoCount.toString()}
          description="Videos in all stages"
          icon={<Video className="h-4 w-4 text-muted-foreground" />}
        />
        <StatsCard
          title="Published"
          value="–"
          description="Videos published this month"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        />
        <StatsCard
          title="Est. Revenue"
          value="–"
          description="This month (USD)"
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {channelCount === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Youtube className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Connect your first YouTube channel</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect a YouTube channel to start automating your content pipeline.
          </p>
          <a
            href="/channels/new"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Youtube className="h-4 w-4" />
            Connect Channel
          </a>
        </div>
      )}
    </div>
  )
}
