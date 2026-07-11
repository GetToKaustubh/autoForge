import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videos } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'

const updateVideoSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(5000).optional(),
  scriptId: z.string().uuid().optional(),
  voiceGenId: z.string().uuid().optional(),
  thumbnailId: z.string().uuid().optional(),
  ytTitle: z.string().max(100).optional(),
  ytDescription: z.string().max(5000).optional(),
  ytTags: z.array(z.string().max(100)).max(500).optional(),
  ytCategoryId: z.string().optional(),
  ytLanguage: z.string().optional(),
  ytMadeForKids: z.boolean().optional(),
  ytVisibility: z.enum(['public', 'private', 'unlisted']).optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.organizationId, member.orgDbId), isNull(videos.deletedAt)))
    .limit(1)

  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ video })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateVideoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [existing] = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.organizationId, member.orgDbId), isNull(videos.deletedAt)))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [updated] = await db
    .update(videos)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(videos.id, id))
    .returning()

  return NextResponse.json({ video: updated })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params

  const [existing] = await db
    .select({ id: videos.id, pipelineStage: videos.pipelineStage })
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.organizationId, member.orgDbId), isNull(videos.deletedAt)))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.pipelineStage === 'uploaded' || existing.pipelineStage === 'published') {
    return NextResponse.json({ error: 'Cannot delete uploaded or published videos' }, { status: 409 })
  }

  await db
    .update(videos)
    .set({ deletedAt: new Date() })
    .where(eq(videos.id, id))

  return new NextResponse(null, { status: 204 })
}
