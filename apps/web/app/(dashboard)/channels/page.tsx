import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { organizations, youtubeChannels } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { Plus, Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChannelCard } from '@/components/channels/channel-card'

export const metadata = { title: 'Channels' }

export default async function ChannelsPage() {
  const { orgId } = await auth()

  const [org] = orgId
    ? await db
        .select({ id: organizations.id, maxChannels: organizations.maxChannels })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, orgId!))
        .limit(1)
    : [null]

  const channels = org
    ? await db
        .select()
        .from(youtubeChannels)
        .where(eq(youtubeChannels.organizationId, org.id) && isNull(youtubeChannels.deletedAt))
        .orderBy(youtubeChannels.isPrimary, youtubeChannels.createdAt)
    : []

  const canAddMore = org ? channels.length < org.maxChannels : false

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
          <p className="text-muted-foreground">
            Manage your connected YouTube channels ({channels.length}/{org?.maxChannels ?? 1})
          </p>
        </div>
        {canAddMore && (
          <Button asChild>
            <Link href="/channels/new">
              <Plus className="mr-2 h-4 w-4" />
              Connect Channel
            </Link>
          </Button>
        )}
      </div>

      {channels.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Youtube className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">No channels connected</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect your first YouTube channel to get started.
          </p>
          <Button asChild className="mt-4">
            <Link href="/channels/new">
              <Plus className="mr-2 h-4 w-4" />
              Connect Channel
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </div>
  )
}
