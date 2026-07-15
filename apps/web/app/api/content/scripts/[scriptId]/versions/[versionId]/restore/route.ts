import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, scriptVersions } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { ensureCurrentVersion } from '@/lib/services/script-editor'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string; versionId: string }> }
) {
  const { scriptId, versionId } = await params
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

  const [target] = await db
    .select()
    .from(scriptVersions)
    .where(and(eq(scriptVersions.id, versionId), eq(scriptVersions.scriptId, scriptId)))
    .limit(1)
  if (!target) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const current = await ensureCurrentVersion(script, member.orgDbId, member.userDbId)
  if (current.id === target.id) {
    return NextResponse.json({ error: 'This version is already current' }, { status: 400 })
  }

  const result = await db.transaction(async (tx) => {
    const maxRows = await tx
      .select({ max: sql<number>`coalesce(max(${scriptVersions.versionNumber}), 0)` })
      .from(scriptVersions)
      .where(eq(scriptVersions.scriptId, scriptId))
    const nextVersionNumber = Number(maxRows[0]?.max ?? 0) + 1

    await tx.update(scriptVersions).set({ isCurrent: false }).where(eq(scriptVersions.id, current.id))

    const [newVersion] = await tx
      .insert(scriptVersions)
      .values({
        scriptId,
        organizationId: member.orgDbId,
        versionNumber: nextVersionNumber,
        parentVersionId: current.id,
        sections: target.sections,
        fullText: target.fullText,
        wordCount: target.wordCount,
        estimatedDurationSec: target.estimatedDurationSec,
        instruction: `Restored to Version ${target.versionNumber}`,
        isCurrent: true,
        createdBy: member.userDbId,
      })
      .returning()
    if (!newVersion) throw new Error('Failed to create version')

    const [updatedScript] = await tx
      .update(scripts)
      .set({
        sections: target.sections,
        fullText: target.fullText,
        wordCount: target.wordCount,
        estimatedDurationSec: target.estimatedDurationSec,
        version: nextVersionNumber,
        redoVersionId: null,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId))
      .returning()

    return { script: updatedScript, version: newVersion }
  })

  return NextResponse.json(result)
}
