import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, scriptEditMessages, apiUsage } from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { ensureCurrentVersion, callGeminiScriptEdit, wordsAndDuration, type ScriptEditSection } from '@/lib/services/script-editor'

const RECENT_INSTRUCTIONS_LIMIT = 6

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ scriptId: string; messageId: string }> }
) {
  const { scriptId, messageId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:script-edit`)
  if (rateLimitRes) return rateLimitRes

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
    return NextResponse.json({ error: 'Only a pending proposal can be regenerated' }, { status: 400 })
  }

  const currentVersion = await ensureCurrentVersion(script, member.orgDbId, member.userDbId)

  const recentAccepted = await db
    .select({ instruction: scriptEditMessages.instruction })
    .from(scriptEditMessages)
    .where(and(eq(scriptEditMessages.scriptId, scriptId), eq(scriptEditMessages.status, 'accepted')))
    .orderBy(desc(scriptEditMessages.createdAt))
    .limit(RECENT_INSTRUCTIONS_LIMIT)

  let editResult: Awaited<ReturnType<typeof callGeminiScriptEdit>>
  try {
    editResult = await callGeminiScriptEdit({
      currentSections: currentVersion.sections as ScriptEditSection[],
      recentInstructions: recentAccepted.map((r) => r.instruction).reverse(),
      instruction: message.instruction,
    })
  } catch (err) {
    await db
      .update(scriptEditMessages)
      .set({ errorMessage: err instanceof Error ? err.message : 'AI edit failed. Please retry.' })
      .where(eq(scriptEditMessages.id, messageId))
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI edit failed. Please retry.' },
      { status: 502 }
    )
  }

  const { fullText } = wordsAndDuration(editResult.sections)

  const [updated] = await db
    .update(scriptEditMessages)
    .set({
      proposedSections: editResult.sections,
      proposedFullText: fullText,
      regenerationCount: sql`${scriptEditMessages.regenerationCount} + 1`,
      tokensUsed: editResult.inputTokens + editResult.outputTokens,
      errorMessage: null,
    })
    .where(eq(scriptEditMessages.id, messageId))
    .returning()

  await db.insert(apiUsage).values({
    organizationId: member.orgDbId,
    userId: member.userDbId,
    service: 'openai',
    endpoint: 'script-edit',
    unitsUsed: String(editResult.inputTokens + editResult.outputTokens),
    unitType: 'tokens',
    costUsd: editResult.costUsd.toFixed(6),
    resourceType: 'script',
    resourceId: scriptId,
  })

  return NextResponse.json(updated)
}
