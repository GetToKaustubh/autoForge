import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scriptEditMessages } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string; messageId: string }> }
) {
  const { scriptId, messageId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [message] = await db
    .select()
    .from(scriptEditMessages)
    .where(and(
      eq(scriptEditMessages.id, messageId),
      eq(scriptEditMessages.scriptId, scriptId),
      eq(scriptEditMessages.organizationId, member.orgDbId),
    ))
    .limit(1)
  if (!message) return NextResponse.json({ error: 'Edit message not found' }, { status: 404 })
  if (message.status !== 'pending') {
    return NextResponse.json({ error: 'Only a pending proposal can be discarded' }, { status: 400 })
  }

  const [updated] = await db
    .update(scriptEditMessages)
    .set({ status: 'discarded' })
    .where(eq(scriptEditMessages.id, messageId))
    .returning()

  return NextResponse.json(updated)
}
