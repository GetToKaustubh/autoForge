import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { thumbnails } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:thumbnails`)
  if (rateLimitRes) return rateLimitRes

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [thumbnail] = await db
    .select()
    .from(thumbnails)
    .where(and(eq(thumbnails.id, id), eq(thumbnails.organizationId, member.orgDbId)))
    .limit(1)
  if (!thumbnail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (thumbnail.status === 'pending' || thumbnail.status === 'processing') {
    return NextResponse.json({ error: 'This thumbnail is already generating' }, { status: 409 })
  }

  const variantCount = (thumbnail.variants as unknown[]).length || 3

  // model isn't its own column - recovered from the generationModel string
  // set by the previous run so regenerate doesn't silently switch a thumbnail
  // that was generated with Imagen back to the Pollinations default.
  const MODEL_ID_TO_KEY: Record<string, 'imagen-fast' | 'imagen-standard' | 'imagen-ultra'> = {
    'gemini-3.1-flash-lite-image': 'imagen-fast',
    'gemini-2.5-flash-image': 'imagen-standard',
    'gemini-3-pro-image': 'imagen-ultra',
  }
  const model = (thumbnail.generationModel && MODEL_ID_TO_KEY[thumbnail.generationModel]) || 'pollinations'

  const handle = await tasks.trigger(TASK_IDS.THUMBNAIL_GENERATION, {
    thumbnailId: thumbnail.id,
    // No separate videoTitle column is persisted - the concept prompt already
    // captures full context, and the generation task ignores videoTitle
    // entirely once a concept longer than 150 chars is present.
    videoTitle: thumbnail.prompt,
    thumbnailConcept: thumbnail.prompt,
    organizationId: member.orgDbId,
    userId: member.userDbId,
    variantCount,
    model,
  })

  const [updated] = await db
    .update(thumbnails)
    .set({
      status: 'pending',
      variants: [],
      selectedUrl: null,
      errorMessage: null,
      triggerJobId: handle.id,
    })
    .where(eq(thumbnails.id, id))
    .returning()

  return NextResponse.json({ ...updated, generating: true })
}
