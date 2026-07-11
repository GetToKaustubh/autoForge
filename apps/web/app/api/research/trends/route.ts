import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, organizationMembers, users, trends } from '@/lib/db/schema'
import { eq, and, desc, gt } from 'drizzle-orm'
import { z } from 'zod'
import { tasks, TASK_IDS } from '@/lib/queue/client'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { redis, cacheKeys } from '@/lib/cache/redis'

const postSchema = z.object({
  topic: z.string().min(2).max(200),
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

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:trends`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { topic, niche, channelId } = parsed.data

  const member = await getOrgAndUser(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  // Check Redis cache for non-expired trend data (6h TTL)
  const cacheKey = cacheKeys.trendResults(topic, member.orgDbId)
  const cached = await redis.get<{ id: string; trendData: unknown }>(cacheKey)
  if (cached) {
    return NextResponse.json({ id: cached.id, trendData: cached.trendData, fromCache: true })
  }

  const [record] = await db
    .insert(trends)
    .values({
      organizationId: member.orgDbId,
      channelId: channelId ?? null,
      topic,
      source: 'ai',
    })
    .returning({ id: trends.id })

  if (!record) return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })

  await tasks.trigger(TASK_IDS.TREND_DISCOVERY, {
    trendId: record.id,
    topic,
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
  const activeOnly = url.searchParams.get('activeOnly') === 'true'

  const conditions = [eq(trends.organizationId, member.orgDbId)]
  if (activeOnly) {
    conditions.push(gt(trends.expiresAt, new Date()))
  }

  const results = await db
    .select()
    .from(trends)
    .where(and(...conditions))
    .orderBy(desc(trends.discoveredAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ results, limit, offset })
}
