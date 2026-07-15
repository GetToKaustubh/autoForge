import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, scriptVersions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { ensureCurrentVersion } from '@/lib/services/script-editor'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  const { scriptId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)
  if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 })

  const current = await ensureCurrentVersion(script, member.orgDbId, member.userDbId)
  if (!current.parentVersionId) {
    return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 })
  }

  const [parent] = await db
    .select()
    .from(scriptVersions)
    .where(and(eq(scriptVersions.id, current.parentVersionId), eq(scriptVersions.scriptId, scriptId)))
    .limit(1)
  if (!parent) return NextResponse.json({ error: 'Previous version no longer exists' }, { status: 404 })

  const result = await db.transaction(async (tx) => {
    await tx.update(scriptVersions).set({ isCurrent: false }).where(eq(scriptVersions.id, current.id))
    await tx.update(scriptVersions).set({ isCurrent: true }).where(eq(scriptVersions.id, parent.id))

    const [updatedScript] = await tx
      .update(scripts)
      .set({
        sections: parent.sections,
        fullText: parent.fullText,
        wordCount: parent.wordCount,
        estimatedDurationSec: parent.estimatedDurationSec,
        version: parent.versionNumber,
        redoVersionId: current.id,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId))
      .returning()

    return { script: updatedScript, version: parent }
  })

  return NextResponse.json(result)
}
