import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { contentCalendar } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite, canAdmin } from '@/lib/auth/get-member'

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  plannedTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  type: z.enum(['video', 'short', 'live', 'community_post']).optional(),
  status: z.enum(['planned', 'in_production', 'ready', 'published', 'skipped']).optional(),
  notes: z.string().max(1000).optional(),
  color: z.string().max(20).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [updated] = await db
    .update(contentCalendar)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(contentCalendar.id, id), eq(contentCalendar.organizationId, member.orgDbId)))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member || !canAdmin(member.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [deleted] = await db
    .delete(contentCalendar)
    .where(and(eq(contentCalendar.id, id), eq(contentCalendar.organizationId, member.orgDbId)))
    .returning({ id: contentCalendar.id })

  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
