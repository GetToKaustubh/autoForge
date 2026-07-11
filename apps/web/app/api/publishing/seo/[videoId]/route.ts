import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seoOptimizations, videos } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const runSeoSchema = z.object({
  targetKeywords: z.array(z.string().max(100)).max(20).optional(),
  channelNiche: z.string().max(100).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:seo`)
  if (rateLimitRes) return rateLimitRes

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { videoId } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = runSeoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [video] = await db
    .select({
      id: videos.id,
      title: videos.title,
      description: videos.description,
      ytTags: videos.ytTags,
      pipelineStage: videos.pipelineStage,
    })
    .from(videos)
    .where(and(
      eq(videos.id, videoId),
      eq(videos.organizationId, member.orgDbId),
      isNull(videos.deletedAt),
    ))
    .limit(1)

  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  // Upsert SEO record
  const [seo] = await db
    .insert(seoOptimizations)
    .values({
      organizationId: member.orgDbId,
      videoId,
    })
    .onConflictDoUpdate({
      target: seoOptimizations.videoId,
      set: { updatedAt: new Date() },
    })
    .returning()

  if (!seo) return NextResponse.json({ error: 'Failed to create SEO record' }, { status: 500 })

  const handle = await tasks.trigger(TASK_IDS.SEO_OPTIMIZATION, {
    videoId,
    seoId: seo.id,
    organizationId: member.orgDbId,
    currentTitle: video.title,
    currentDescription: video.description ?? undefined,
    currentTags: video.ytTags ?? undefined,
    targetKeywords: parsed.data.targetKeywords,
    channelNiche: parsed.data.channelNiche,
  })

  await db
    .update(seoOptimizations)
    .set({ triggerJobId: handle.id })
    .where(eq(seoOptimizations.id, seo.id))

  return NextResponse.json({ seoId: seo.id, triggerJobId: handle.id, status: 'processing' }, { status: 202 })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { videoId } = await params

  const [seo] = await db
    .select()
    .from(seoOptimizations)
    .where(and(
      eq(seoOptimizations.videoId, videoId),
      eq(seoOptimizations.organizationId, member.orgDbId),
    ))
    .limit(1)

  if (!seo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(seo)
}
