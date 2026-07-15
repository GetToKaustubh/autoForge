import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, scriptVersions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getOrgMember } from '@/lib/auth/get-member'
import { ensureCurrentVersion } from '@/lib/services/script-editor'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  const { scriptId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)
  if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 })

  if (!script.fullText || !Array.isArray(script.sections) || script.sections.length === 0) {
    return NextResponse.json({ versions: [], currentVersionId: null, canUndo: false, canRedo: false })
  }

  const current = await ensureCurrentVersion(script, member.orgDbId, member.userDbId)

  const versions = await db
    .select()
    .from(scriptVersions)
    .where(eq(scriptVersions.scriptId, scriptId))
    .orderBy(scriptVersions.versionNumber)

  return NextResponse.json({
    versions,
    currentVersionId: current.id,
    canUndo: !!current.parentVersionId,
    canRedo: !!script.redoVersionId,
  })
}
