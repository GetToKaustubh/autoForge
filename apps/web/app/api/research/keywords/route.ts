import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, organizationMembers, users, keywordResearch } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { tasks, TASK_IDS } from '@/lib/queue/client'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { redis, cacheKeys } from '@/lib/cache/redis'

const postSchema = z.object({
  seedKeyword: z.string().min(1).max(100),
  niche: z.string().max(100).optional(),
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

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:keywords`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { seedKeyword, niche, channelId } = parsed.data

  const member = await getOrgAndUser(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  // Check Redis cache — avoid re-running identical research within 24h
  const cacheKey = cacheKeys.keywordResults(seedKeyword, member.orgDbId)
  const cached = await redis.get<{ id: string; results: unknown }>(cacheKey)
  if (cached) {
    return NextResponse.json({ id: cached.id, results: cached.results, fromCache: true })
  }

  const [record] = await db
    .insert(keywordResearch)
    .values({
      organizationId: member.orgDbId,
      channelId: channelId ?? null,
      seedKeyword,
      source: 'ai',
    })
    .returning({ id: keywordResearch.id })

  if (!record) return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })

  await tasks.trigger(TASK_IDS.KEYWORD_RESEARCH, {
    researchId: record.id,
    seedKeyword,
    niche,
    organizationId: member.orgDbId,
    userId: member.userDbId,
  })

  return NextResponse.json({ id: record.id, status: 'processing' }, { status: 202 })
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
    .select()
    .from(keywordResearch)
    .where(eq(keywordResearch.organizationId, member.orgDbId))
    .orderBy(desc(keywordResearch.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ results, limit, offset })
}
