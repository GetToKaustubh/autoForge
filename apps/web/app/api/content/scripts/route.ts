import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, youtubeChannels, videoIdeas } from '@/lib/db/schema'
import { eq, and, desc, isNull, or, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const createScriptSchema = z.object({
  channelId: z.string().uuid(),
  ideaId: z.string().uuid().optional(),
  title: z.string().min(3).max(300),
  targetDurationSec: z.number().int().min(60).max(7200).optional(),
  tone: z.string().max(100).optional(),
  generateWithAI: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:scripts`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = createScriptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { channelId, ideaId, title, targetDurationSec, tone, generateWithAI } = parsed.data

  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(
      eq(youtubeChannels.id, channelId),
      eq(youtubeChannels.organizationId, member.orgDbId),
      isNull(youtubeChannels.deletedAt),
    ))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const [script] = await db
    .insert(scripts)
    .values({
      organizationId: member.orgDbId,
      channelId,
      ideaId,
      createdBy: member.userDbId,
      title,
      status: 'draft',
    })
    .returning()

  if (!script) return NextResponse.json({ error: 'Failed to create script' }, { status: 500 })

  if (generateWithAI && ideaId) {
    const handle = await tasks.trigger(TASK_IDS.SCRIPT_GENERATION, {
      scriptId: script.id,
      ideaId,
      organizationId: member.orgDbId,
      targetDurationSec: targetDurationSec ?? 600,
      tone: tone ?? 'engaging and educational',
    })
    const [updated] = await db
      .update(scripts)
      .set({ triggerJobId: handle.id })
      .where(eq(scripts.id, script.id))
      .returning()
    return NextResponse.json({ ...updated, generating: true }, { status: 201 })
  }

  return NextResponse.json(script, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  const status = url.searchParams.get('status')
  const activeIdeaOnly = url.searchParams.get('activeIdeaOnly') === 'true'
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '30'), 100)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const conditions = [eq(scripts.organizationId, member.orgDbId)]
  if (channelId) conditions.push(eq(scripts.channelId, channelId))
  if (status) conditions.push(eq(scripts.status, status as 'draft' | 'review' | 'approved' | 'in_production' | 'archived'))
  // "Pick a script" dropdowns (Voice, Video) opt into this so a script whose
  // idea was removed from the Approved/In Production Kanban columns stops
  // being offered there — the script row itself is untouched, just hidden
  // from "start new work from this" pickers. Scripts with no linked idea
  // (created manually) are unaffected.
  if (activeIdeaOnly) {
    const excludedIdeaIds = db
      .select({ id: videoIdeas.id })
      .from(videoIdeas)
      .where(and(
        eq(videoIdeas.organizationId, member.orgDbId),
        or(eq(videoIdeas.status, 'archived'), eq(videoIdeas.status, 'rejected')),
      ))
    const activeIdeaCondition = or(isNull(scripts.ideaId), notInArray(scripts.ideaId, excludedIdeaIds))
    if (activeIdeaCondition) conditions.push(activeIdeaCondition)
  }

  const results = await db
    .select({
      id: scripts.id,
      title: scripts.title,
      status: scripts.status,
      wordCount: scripts.wordCount,
      estimatedDurationSec: scripts.estimatedDurationSec,
      version: scripts.version,
      modelUsed: scripts.modelUsed,
      triggerJobId: scripts.triggerJobId,
      ideaId: scripts.ideaId,
      channelId: scripts.channelId,
      createdAt: scripts.createdAt,
      updatedAt: scripts.updatedAt,
    })
    .from(scripts)
    .where(and(...conditions))
    .orderBy(desc(scripts.updatedAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ scripts: results, limit, offset })
}
