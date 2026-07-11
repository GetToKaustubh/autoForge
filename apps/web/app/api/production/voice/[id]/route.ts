import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { voiceGenerations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getOrgMember } from '@/lib/auth/get-member'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const [voiceGen] = await db
    .select()
    .from(voiceGenerations)
    .where(and(eq(voiceGenerations.id, id), eq(voiceGenerations.organizationId, member.orgDbId)))
    .limit(1)

  if (!voiceGen) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: voiceGen.status,
    data: voiceGen,
    error: voiceGen.errorMessage ?? null,
  })
}
