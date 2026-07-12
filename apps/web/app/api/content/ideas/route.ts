import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videoIdeas, youtubeChannels } from '@/lib/db/schema'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const createIdeaSchema = z.object({
  channelId: z.string().uuid(),
  title: z.string().min(3).max(300),
  hook: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  format: z.enum(['tutorial', 'review', 'listicle', 'vlog', 'documentary', 'shorts', 'live', 'comparison']).optional(),
  targetKeywords: z.array(z.string().max(100)).max(20).optional(),
  estimatedViewsMin: z.number().int().min(0).optional(),
  estimatedViewsMax: z.number().int().min(0).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  nicheResearchId: z.string().uuid().optional(),
  trendId: z.string().uuid().optional(),
  autoGenerate: z.boolean().optional(), // trigger idea-generation task
  niche: z.string().min(2).max(200).optional(), // required when autoGenerate is true
  keywords: z.array(z.string().max(100)).max(20).optional(),
  trendContext: z.array(z.string().max(200)).max(10).optional(),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.api, `${orgId}:ideas`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = createIdeaSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { autoGenerate, ...data } = parsed.data

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // Verify channel belongs to this org
  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(
      eq(youtubeChannels.id, data.channelId),
      eq(youtubeChannels.organizationId, member.orgDbId),
      isNull(youtubeChannels.deletedAt),
    ))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  if (autoGenerate) {
    if (!data.niche) {
      return NextResponse.json({ error: 'niche is required when autoGenerate is true' }, { status: 400 })
    }
    // Trigger AI idea generation task (creates ideas in DB itself)
    const handle = await tasks.trigger(TASK_IDS.IDEA_GENERATION, {
      channelId: data.channelId,
      organizationId: member.orgDbId,
      userId: member.userDbId,
      niche: data.niche,
      keywords: data.keywords,
      trendContext: data.trendContext,
    })
    return NextResponse.json({ triggerJobId: handle.id, status: 'processing' }, { status: 202 })
  }

  const [idea] = await db
    .insert(videoIdeas)
    .values({
      organizationId: member.orgDbId,
      channelId: data.channelId,
      createdBy: member.userDbId,
      title: data.title,
      hook: data.hook,
      description: data.description,
      format: data.format,
      targetKeywords: data.targetKeywords,
      estimatedViewsMin: data.estimatedViewsMin,
      estimatedViewsMax: data.estimatedViewsMax,
      priority: data.priority ?? 5,
      nicheResearchId: data.nicheResearchId,
      trendId: data.trendId,
      status: 'idea',
    })
    .returning()

  return NextResponse.json(idea, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  const status = url.searchParams.get('status')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const conditions = [eq(videoIdeas.organizationId, member.orgDbId)]
  if (channelId) conditions.push(eq(videoIdeas.channelId, channelId))
  if (status) conditions.push(eq(videoIdeas.status, status as 'idea' | 'approved' | 'in_production' | 'published' | 'rejected' | 'archived'))

  const ideas = await db
    .select()
    .from(videoIdeas)
    .where(and(...conditions))
    .orderBy(desc(videoIdeas.priority), desc(videoIdeas.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ ideas, limit, offset })
}
