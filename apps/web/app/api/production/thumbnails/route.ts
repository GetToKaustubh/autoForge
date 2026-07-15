import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { thumbnails, youtubeChannels } from '@/lib/db/schema'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const createThumbnailSchema = z.object({
  channelId: z.string().uuid(),
  ideaId: z.string().uuid().optional(),
  videoTitle: z.string().min(3).max(200),
  // Detailed art-direction concepts (composition, lighting, text callouts, etc.)
  // routinely run well past a short-keyword length - 500 was rejecting real
  // user prompts with a bare "Invalid request", raised with headroom to spare.
  prompt: z.string().max(3000).optional(),
  style: z.enum(['bold', 'cinematic', 'minimalist', 'viral', 'educational']).optional(),
  variantCount: z.number().int().min(1).max(3).default(3),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:thumbnails`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = createThumbnailSchema.safeParse(body)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const detail = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request'
    return NextResponse.json({ error: detail, details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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

  const concept = parsed.data.prompt
    ? `${parsed.data.style ? `Style: ${parsed.data.style}. ` : ''}${parsed.data.prompt}`
    : parsed.data.style
      ? `Style: ${parsed.data.style}`
      : undefined

  const [thumbnail] = await db
    .insert(thumbnails)
    .values({
      organizationId: member.orgDbId,
      channelId: parsed.data.channelId,
      ideaId: parsed.data.ideaId,
      createdBy: member.userDbId,
      prompt: concept ?? parsed.data.videoTitle,
      style: parsed.data.style,
      status: 'pending',
    })
    .returning()

  if (!thumbnail) return NextResponse.json({ error: 'Failed to create thumbnail' }, { status: 500 })

  const handle = await tasks.trigger(TASK_IDS.THUMBNAIL_GENERATION, {
    thumbnailId: thumbnail.id,
    videoTitle: parsed.data.videoTitle,
    thumbnailConcept: concept,
    organizationId: member.orgDbId,
    userId: member.userDbId,
    variantCount: parsed.data.variantCount,
  })

  await db
    .update(thumbnails)
    .set({ triggerJobId: handle.id })
    .where(eq(thumbnails.id, thumbnail.id))

  return NextResponse.json({ ...thumbnail, triggerJobId: handle.id }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const conditions = [eq(thumbnails.organizationId, member.orgDbId), isNull(thumbnails.deletedAt)]
  if (channelId) conditions.push(eq(thumbnails.channelId, channelId))

  const results = await db
    .select()
    .from(thumbnails)
    .where(and(...conditions))
    .orderBy(desc(thumbnails.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ thumbnails: results, limit, offset })
}
