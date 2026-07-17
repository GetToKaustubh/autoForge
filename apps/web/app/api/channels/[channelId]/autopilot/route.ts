import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { youtubeChannels } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { schedules } from '@trigger.dev/sdk'
import { TASK_IDS } from '@/lib/queue/client'

const bodySchema = z.object({
  enabled: z.boolean(),
  nichePrompt: z.string().min(1).max(2000).optional(),
  provider: z.enum(['stock', 'ai-image', 'runway', 'pika', 'veo']).optional(),
  mode: z.enum(['review', 'auto']).optional(),
  scheduleHourUtc: z.number().int().min(0).max(23).optional(),
  targetAudience: z.string().max(500).optional(),
  format: z.string().max(50).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  // Autopilot is a standing unattended-spend-and-publish toggle — stricter than
  // the plain settings PATCH next to it, which only editors+ can touch.
  if (!member || !canAdmin(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { channelId } = await params
  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const [channel] = await db
    .select()
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.id, channelId), eq(youtubeChannels.organizationId, member.orgDbId), isNull(youtubeChannels.deletedAt)))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  if (!parsed.data.enabled) {
    if (channel.autopilotScheduleId) {
      await schedules.deactivate(channel.autopilotScheduleId).catch(() => {})
    }
    const [updated] = await db
      .update(youtubeChannels)
      .set({ autopilotEnabled: false, autopilotScheduleId: null, updatedAt: new Date() })
      .where(eq(youtubeChannels.id, channelId))
      .returning()
    return NextResponse.json({ channel: updated })
  }

  const nichePrompt = parsed.data.nichePrompt ?? channel.autopilotNichePrompt
  if (!nichePrompt) {
    return NextResponse.json({ error: 'A niche/style prompt is required to enable autopilot' }, { status: 400 })
  }

  const scheduleHourUtc = parsed.data.scheduleHourUtc ?? channel.autopilotScheduleHourUtc
  const cron = `0 ${scheduleHourUtc} * * *`

  const created = await schedules.create({
    task: TASK_IDS.AUTOPILOT_SCHEDULE,
    cron,
    externalId: channelId,
    deduplicationKey: `autopilot-${channelId}`,
  })

  const [updated] = await db
    .update(youtubeChannels)
    .set({
      autopilotEnabled: true,
      autopilotNichePrompt: nichePrompt,
      autopilotProvider: parsed.data.provider ?? channel.autopilotProvider,
      autopilotMode: parsed.data.mode ?? channel.autopilotMode,
      autopilotScheduleHourUtc: scheduleHourUtc,
      autopilotTargetAudience: parsed.data.targetAudience ?? channel.autopilotTargetAudience,
      autopilotFormat: parsed.data.format ?? channel.autopilotFormat,
      autopilotScheduleId: created.id,
      autopilotConsecutiveFailures: 0,
      updatedAt: new Date(),
    })
    .where(eq(youtubeChannels.id, channelId))
    .returning()

  return NextResponse.json({ channel: updated })
}
