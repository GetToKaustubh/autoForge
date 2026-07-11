import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scheduledUploads } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'

const updateScheduleSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  timezone: z.string().optional(),
  status: z.enum(['cancelled']).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canAdmin(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateScheduleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [existing] = await db
    .select({ id: scheduledUploads.id, status: scheduledUploads.status })
    .from(scheduledUploads)
    .where(and(eq(scheduledUploads.id, id), eq(scheduledUploads.organizationId, member.orgDbId)))
    .limit(1)

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.status === 'uploading' || existing.status === 'uploaded') {
    return NextResponse.json({ error: 'Cannot modify an upload in progress or already uploaded' }, { status: 409 })
  }

  const updates: {
    scheduledAt?: Date
    timezone?: string
    status?: 'scheduled' | 'uploading' | 'uploaded' | 'failed' | 'cancelled'
    updatedAt?: Date
  } = {}

  if (parsed.data.scheduledAt) {
    const newTime = new Date(parsed.data.scheduledAt)
    if (newTime <= new Date()) {
      return NextResponse.json({ error: 'Scheduled time must be in the future' }, { status: 400 })
    }
    updates.scheduledAt = newTime
  }
  if (parsed.data.timezone) updates.timezone = parsed.data.timezone
  if (parsed.data.status) updates.status = parsed.data.status

  const [updated] = await db
    .update(scheduledUploads)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(scheduledUploads.id, id))
    .returning()

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canAdmin(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params

  const [existing] = await db
    .select({ id: scheduledUploads.id, status: scheduledUploads.status })
    .from(scheduledUploads)
    .where(and(eq(scheduledUploads.id, id), eq(scheduledUploads.organizationId, member.orgDbId)))
    .limit(1)

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'uploading') {
    return NextResponse.json({ error: 'Cannot delete an upload in progress' }, { status: 409 })
  }

  await db.delete(scheduledUploads).where(eq(scheduledUploads.id, id))

  return new NextResponse(null, { status: 204 })
}
