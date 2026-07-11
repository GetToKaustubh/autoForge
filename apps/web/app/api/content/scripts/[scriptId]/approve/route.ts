import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  const { scriptId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canAdmin(member.role)) {
    return NextResponse.json({ error: 'Only admins can approve scripts' }, { status: 403 })
  }

  const [script] = await db
    .select({ id: scripts.id, status: scripts.status, organizationId: scripts.organizationId })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)

  if (!script) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (script.status !== 'review') {
    return NextResponse.json({ error: `Script must be in 'review' status to approve (current: ${script.status})` }, { status: 409 })
  }

  const [updated] = await db
    .update(scripts)
    .set({
      status: 'approved',
      approvedBy: member.userDbId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scripts.id, scriptId))
    .returning({ id: scripts.id, status: scripts.status, approvedAt: scripts.approvedAt })

  return NextResponse.json(updated)
}
