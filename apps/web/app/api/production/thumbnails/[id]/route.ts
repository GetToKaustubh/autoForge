import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { thumbnails } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'

const updateThumbnailSchema = z.object({
  selectedUrl: z.string().url().optional(),
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

  const [thumbnail] = await db
    .select()
    .from(thumbnails)
    .where(and(eq(thumbnails.id, id), eq(thumbnails.organizationId, member.orgDbId)))
    .limit(1)

  if (!thumbnail) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: thumbnail.status,
    data: thumbnail,
    error: thumbnail.errorMessage ?? null,
  })
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
  const parsed = updateThumbnailSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [existing] = await db
    .select({ id: thumbnails.id })
    .from(thumbnails)
    .where(and(eq(thumbnails.id, id), eq(thumbnails.organizationId, member.orgDbId)))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [updated] = await db
    .update(thumbnails)
    .set(parsed.data)
    .where(eq(thumbnails.id, id))
    .returning()

  return NextResponse.json(updated)
}
