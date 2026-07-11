import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, organizationMembers, users, nicheResearch } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { tasks } from '@/lib/queue/client'
import { TASK_IDS } from '@/lib/queue/client'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'

const postSchema = z.object({
  query: z.string().min(2).max(200),
  channelId: z.string().uuid().optional(),
})

async function getOrgAndUser(orgId: string, clerkUserId: string) {
  const [member] = await db
    .select({
      orgDbId: organizations.id,
      userDbId: users.id,
      role: organizationMembers.role,
    })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.clerkOrgId, orgId), eq(users.clerkId, clerkUserId)))
    .limit(1)

  return member ?? null
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:niches`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { query, channelId } = parsed.data

  const member = await getOrgAndUser(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  // Create DB record first (status defaults to 'completed' in schema but we set 'pending')
  const [record] = await db
    .insert(nicheResearch)
    .values({
      organizationId: member.orgDbId,
      channelId: channelId ?? null,
      createdBy: member.userDbId,
      query,
      modelUsed: 'claude-sonnet-4-6',
      status: 'pending',
    })
    .returning({ id: nicheResearch.id })

  if (!record) return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })

  // Trigger background job
  const handle = await tasks.trigger(TASK_IDS.NICHE_RESEARCH, {
    researchId: record.id,
    query,
    organizationId: member.orgDbId,
    userId: member.userDbId,
  })

  // Store trigger job ID
  await db
    .update(nicheResearch)
    .set({ triggerJobId: handle.id })
    .where(eq(nicheResearch.id, record.id))

  return NextResponse.json({ id: record.id, triggerJobId: handle.id, status: 'pending' }, { status: 202 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgAndUser(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const results = await db
    .select({
      id: nicheResearch.id,
      query: nicheResearch.query,
      niches: nicheResearch.niches,
      modelUsed: nicheResearch.modelUsed,
      tokensUsed: nicheResearch.tokensUsed,
      status: nicheResearch.status,
      errorMessage: nicheResearch.errorMessage,
      triggerJobId: nicheResearch.triggerJobId,
      createdAt: nicheResearch.createdAt,
    })
    .from(nicheResearch)
    .where(eq(nicheResearch.organizationId, member.orgDbId))
    .orderBy(desc(nicheResearch.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ results, limit, offset })
}
