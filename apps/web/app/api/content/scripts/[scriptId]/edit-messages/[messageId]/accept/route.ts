import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, scriptEditMessages, scriptVersions } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { ensureCurrentVersion, wordsAndDuration, type ScriptEditSection } from '@/lib/services/script-editor'

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

  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)
  if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 })

  const [message] = await db
    .select()
    .from(scriptEditMessages)
    .where(and(eq(scriptEditMessages.id, messageId), eq(scriptEditMessages.scriptId, scriptId)))
    .limit(1)
  if (!message) return NextResponse.json({ error: 'Edit message not found' }, { status: 404 })
  if (message.status !== 'pending') {
    return NextResponse.json({ error: 'Only a pending proposal can be accepted' }, { status: 400 })
  }
  if (!message.proposedSections) {
    return NextResponse.json({ error: 'This proposal has no content to accept' }, { status: 400 })
  }

  const currentVersion = await ensureCurrentVersion(script, member.orgDbId, member.userDbId)
  const sections = message.proposedSections as ScriptEditSection[]
  const { fullText, wordCount, estimatedDurationSec } = wordsAndDuration(sections)

  const result = await db.transaction(async (tx) => {
    const maxRows = await tx
      .select({ max: sql<number>`coalesce(max(${scriptVersions.versionNumber}), 0)` })
      .from(scriptVersions)
      .where(eq(scriptVersions.scriptId, scriptId))
    const nextVersionNumber = Number(maxRows[0]?.max ?? 0) + 1

    await tx
      .update(scriptVersions)
      .set({ isCurrent: false })
      .where(eq(scriptVersions.id, currentVersion.id))

    const [newVersion] = await tx
      .insert(scriptVersions)
      .values({
        scriptId,
        organizationId: member.orgDbId,
        versionNumber: nextVersionNumber,
        parentVersionId: currentVersion.id,
        sections,
        fullText,
        wordCount,
        estimatedDurationSec,
        instruction: message.instruction,
        isCurrent: true,
        createdBy: member.userDbId,
      })
      .returning()
    if (!newVersion) throw new Error('Failed to create version')

    const [updatedScript] = await tx
      .update(scripts)
      .set({
        sections,
        fullText,
        wordCount,
        estimatedDurationSec,
        version: nextVersionNumber,
        redoVersionId: null,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, scriptId))
      .returning()

    const [updatedMessage] = await tx
      .update(scriptEditMessages)
      .set({ status: 'accepted', resultVersionId: newVersion.id })
      .where(eq(scriptEditMessages.id, messageId))
      .returning()

    return { script: updatedScript, version: newVersion, message: updatedMessage }
  })

  return NextResponse.json(result)
}
