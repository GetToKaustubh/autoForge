import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, organizationMembers, users, youtubeChannels, auditLogs } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { logger } from '@/lib/utils/logger'

async function getOrgAndVerifyAccess(orgId: string, userId: string, channelId: string) {
  const [member] = await db
    .select({
      orgDbId: organizations.id,
      role: organizationMembers.role,
      userId: users.id,
    })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.clerkOrgId, orgId), eq(users.clerkId, userId)))
    .limit(1)

  if (!member) return null

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

  return channel ? { ...member, channel } : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await getOrgAndVerifyAccess(orgId, userId, channelId)
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { channel } = result
  // Never return encrypted tokens
  const safeChannel = {
    id: channel.id,
    ytChannelId: channel.ytChannelId,
    channelName: channel.channelName,
    channelHandle: channel.channelHandle,
    channelThumbnail: channel.channelThumbnail,
    description: channel.description,
    country: channel.country,
    language: channel.language,
    subscriberCount: channel.subscriberCount,
    videoCount: channel.videoCount,
    viewCount: channel.viewCount,
    defaultCategory: channel.defaultCategory,
    defaultTags: channel.defaultTags,
    status: channel.status,
    quotaUsedToday: channel.quotaUsedToday,
    quotaLimitDaily: channel.quotaLimitDaily,
    isPrimary: channel.isPrimary,
    tokenExpiresAt: channel.tokenExpiresAt,
    lastSyncedAt: channel.lastSyncedAt,
    autopilotEnabled: channel.autopilotEnabled,
    autopilotNichePrompt: channel.autopilotNichePrompt,
    autopilotProvider: channel.autopilotProvider,
    autopilotMode: channel.autopilotMode,
    autopilotScheduleHourUtc: channel.autopilotScheduleHourUtc,
    autopilotTargetAudience: channel.autopilotTargetAudience,
    autopilotFormat: channel.autopilotFormat,
    autopilotLastRunAt: channel.autopilotLastRunAt,
    autopilotConsecutiveFailures: channel.autopilotConsecutiveFailures,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  }

  return NextResponse.json({ channel: safeChannel })
}

const patchSchema = z.object({
  defaultCategory: z.string().max(10).optional(),
  defaultTags: z.array(z.string()).max(20).optional(),
  language: z.string().max(10).optional(),
  isPrimary: z.boolean().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await getOrgAndVerifyAccess(orgId, userId, channelId)
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!['owner', 'admin', 'editor'].includes(result.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const updated = await db
    .update(youtubeChannels)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(youtubeChannels.id, channelId))
    .returning()

  logger.info({ channelId, userId }, 'Channel settings updated')
  return NextResponse.json({ channel: updated[0] })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await getOrgAndVerifyAccess(orgId, userId, channelId)
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!['owner', 'admin'].includes(result.role)) {
    return NextResponse.json(
      { error: 'Only owners and admins can disconnect channels' },
      { status: 403 }
    )
  }

  await db
    .update(youtubeChannels)
    .set({
      deletedAt: new Date(),
      status: 'disconnected',
      accessTokenEnc: '',
      refreshTokenEnc: '',
      updatedAt: new Date(),
    })
    .where(eq(youtubeChannels.id, channelId))

  await db.insert(auditLogs).values({
    organizationId: result.orgDbId,
    userId: result.userId,
    action: 'channel.disconnected',
    resourceType: 'youtube_channel',
    resourceId: channelId,
    metadata: { channelId, ytChannelId: result.channel.ytChannelId },
  })

  logger.info({ channelId, userId }, 'Channel disconnected')
  return NextResponse.json({ success: true })
}
