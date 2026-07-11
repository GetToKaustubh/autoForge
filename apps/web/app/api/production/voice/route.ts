import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { voiceGenerations, scripts, youtubeChannels } from '@/lib/db/schema'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const createVoiceSchema = z.object({
  scriptId: z.string().uuid(),
  channelId: z.string().uuid(),
  voiceId: z.string().min(1),
  voiceName: z.string().optional(),
  voiceSettings: z.object({
    stability: z.number().min(0).max(1).default(0.5),
    similarityBoost: z.number().min(0).max(1).default(0.75),
    style: z.number().min(0).max(1).default(0),
    useSpeakerBoost: z.boolean().default(true),
  }).default({}),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:voice`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = createVoiceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // Verify script belongs to this org
  const [script] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.id, parsed.data.scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)
  if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 })

  // Verify channel
  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(
      eq(youtubeChannels.id, parsed.data.channelId),
      eq(youtubeChannels.organizationId, member.orgDbId),
      isNull(youtubeChannels.deletedAt),
    ))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const [voiceGen] = await db
    .insert(voiceGenerations)
    .values({
      organizationId: member.orgDbId,
      scriptId: parsed.data.scriptId,
      createdBy: member.userDbId,
      voiceId: parsed.data.voiceId,
      voiceName: parsed.data.voiceName,
      voiceSettings: parsed.data.voiceSettings,
      status: 'pending',
    })
    .returning()

  if (!voiceGen) return NextResponse.json({ error: 'Failed to create voice generation' }, { status: 500 })

  const handle = await tasks.trigger(TASK_IDS.VOICE_GENERATION, {
    voiceGenId: voiceGen.id,
    scriptId: parsed.data.scriptId,
    organizationId: member.orgDbId,
    voiceId: parsed.data.voiceId,
    voiceSettings: parsed.data.voiceSettings,
  })

  await db
    .update(voiceGenerations)
    .set({ triggerJobId: handle.id })
    .where(eq(voiceGenerations.id, voiceGen.id))

  return NextResponse.json({ ...voiceGen, triggerJobId: handle.id }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const scriptId = url.searchParams.get('scriptId')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const conditions = [eq(voiceGenerations.organizationId, member.orgDbId)]
  if (scriptId) conditions.push(eq(voiceGenerations.scriptId, scriptId))

  const results = await db
    .select()
    .from(voiceGenerations)
    .where(and(...conditions))
    .orderBy(desc(voiceGenerations.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ voiceGenerations: results, limit, offset })
}
