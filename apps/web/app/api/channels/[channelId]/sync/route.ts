import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, organizationMembers, users, youtubeChannels } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getValidAccessToken } from '@/lib/auth/youtube-oauth'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.api, userId)
  if (rateLimitRes) return rateLimitRes

  const [member] = await db
    .select({ orgDbId: organizations.id, role: organizationMembers.role })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.clerkOrgId, orgId), eq(users.clerkId, userId)))
    .limit(1)

  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['owner', 'admin', 'editor'].includes(member.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const [channel] = await db
    .select({ ytChannelId: youtubeChannels.ytChannelId })
    .from(youtubeChannels)
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        eq(youtubeChannels.organizationId, member.orgDbId),
        isNull(youtubeChannels.deletedAt)
      )
    )
    .limit(1)

  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const accessToken = await getValidAccessToken(channelId)

    // Fetch channel info directly (1 quota unit)
    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&id=${channel.ytChannelId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!channelRes.ok) {
      throw new Error(`YouTube API error: ${channelRes.status}`)
    }

    const channelData = (await channelRes.json()) as {
      items: Array<{
        snippet: {
          title: string
          description: string
          customUrl: string
          country?: string
          thumbnails: {
            high?: { url: string }
            medium?: { url: string }
            default?: { url: string }
          }
        }
        statistics: {
          subscriberCount?: string
          videoCount?: string
          viewCount?: string
        }
      }>
    }

    const ytChannel = channelData.items?.[0]
    if (!ytChannel) {
      return NextResponse.json({ error: 'Channel not found on YouTube' }, { status: 404 })
    }

    const { snippet, statistics } = ytChannel

    await db
      .update(youtubeChannels)
      .set({
        channelName: snippet.title,
        channelHandle: snippet.customUrl ?? undefined,
        description: snippet.description ?? undefined,
        channelThumbnail:
          snippet.thumbnails.high?.url ??
          snippet.thumbnails.medium?.url ??
          snippet.thumbnails.default?.url ??
          undefined,
        subscriberCount: statistics.subscriberCount
          ? parseInt(statistics.subscriberCount)
          : undefined,
        videoCount: statistics.videoCount ? parseInt(statistics.videoCount) : undefined,
        viewCount: statistics.viewCount ? parseInt(statistics.viewCount) : undefined,
        country: snippet.country ?? undefined,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(youtubeChannels.id, channelId))

    logger.info({ channelId, ytChannelId: channel.ytChannelId }, 'Channel synced')
    return NextResponse.json({ success: true, syncedAt: new Date().toISOString() })
  } catch (error) {
    logger.error({ channelId, error: String(error) }, 'Channel sync failed')
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
