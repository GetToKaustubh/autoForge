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
  if (!script.redoVersionId) {
    return NextResponse.json({ error: 'Nothing to redo' }, { status: 400 })
  }

  const current = await ensureCurrentVersion(script, member.orgDbId, member.userDbId)

  const [target] = await db
    .select()
    .from(scriptVersions)
    .where(and(eq(scriptVersions.id, script.redoVersionId), eq(scriptVersions.scriptId, scriptId)))
    .limit(1)
  if (!target) return NextResponse.json({ error: 'Version to redo no longer exists' }, { status: 404 })

  const result = await db.transaction(async (tx) => {
    await tx.update(scriptVersions).set({ isCurrent: false }).where(eq(scriptVersions.id, current.id))
    await tx.update(scriptVersions).set({ isCurrent: true }).where(eq(scriptVersions.id, target.id))

    const [updatedScript] = await tx
      .update(scripts)
      .set({
        sections: target.sections,
        fullText: target.fullText,
        wordCount: target.wordCount,
        estimatedDurationSec: target.estimatedDurationSec,
        version: target.versionNumber,
        redoVersionId: null,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId))
      .returning()

    return { script: updatedScript, version: target }
  })

  return NextResponse.json(result)
}
