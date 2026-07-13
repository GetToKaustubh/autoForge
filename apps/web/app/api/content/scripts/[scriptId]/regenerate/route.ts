import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  const { scriptId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:scripts`)
  if (rateLimitRes) return rateLimitRes

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [script] = await db
    .select({
      id: scripts.id,
      ideaId: scripts.ideaId,
      estimatedDurationSec: scripts.estimatedDurationSec,
    })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)

  if (!script) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!script.ideaId) {
    return NextResponse.json(
      { error: 'This script has no linked idea, so it cannot be AI-regenerated' },
      { status: 400 }
    )
  }

  const handle = await tasks.trigger(TASK_IDS.SCRIPT_GENERATION, {
    scriptId: script.id,
    ideaId: script.ideaId,
    organizationId: member.orgDbId,
    targetDurationSec: script.estimatedDurationSec ?? 600,
  })

  const [updated] = await db
    .update(scripts)
    .set({
      status: 'draft',
      sections: [],
      fullText: null,
      wordCount: null,
      estimatedDurationSec: null,
      version: sql`${scripts.version} + 1`,
      triggerJobId: handle.id,
      updatedAt: new Date(),
    })
    .where(eq(scripts.id, scriptId))
    .returning()

  return NextResponse.json({ ...updated, generating: true })
}
