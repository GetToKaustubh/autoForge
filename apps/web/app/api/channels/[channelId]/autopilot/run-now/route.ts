import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { youtubeChannels } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

export async function POST(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:autopilot-run-now`)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member || !canWrite(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { channelId } = await params
  const [channel] = await db
    .select({ id: youtubeChannels.id, autopilotNichePrompt: youtubeChannels.autopilotNichePrompt })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.id, channelId), eq(youtubeChannels.organizationId, member.orgDbId), isNull(youtubeChannels.deletedAt)))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  if (!channel.autopilotNichePrompt) {
    return NextResponse.json({ error: 'Set a niche/style prompt before running autopilot' }, { status: 400 })
  }

  // Same payload shape the schedule fires with — this is a direct test of the
  // real orchestrator, not a separate code path.
  const handle = await tasks.trigger(TASK_IDS.CHANNEL_AUTOPILOT, { channelId })

  return NextResponse.json({ triggered: true, jobId: handle.id }, { status: 202 })
}
