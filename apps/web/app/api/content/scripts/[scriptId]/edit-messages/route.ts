import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts, scriptEditMessages, apiUsage } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { ensureCurrentVersion, callGeminiScriptEdit, wordsAndDuration, type ScriptEditSection } from '@/lib/services/script-editor'

const RECENT_INSTRUCTIONS_LIMIT = 6

const bodySchema = z.object({
  instruction: z.string().trim().min(1, 'Please describe the changes you want to make.').max(2000),
})

async function getScript(orgDbId: string, scriptId: string) {
  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.organizationId, orgDbId)))
    .limit(1)
  return script ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  const { scriptId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const script = await getScript(member.orgDbId, scriptId)
  if (!script) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await db
    .select()
    .from(scriptEditMessages)
    .where(eq(scriptEditMessages.scriptId, scriptId))
    .orderBy(scriptEditMessages.createdAt)

  return NextResponse.json({ messages })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  const { scriptId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:script-edit`)
  if (rateLimitRes) return rateLimitRes

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const script = await getScript(member.orgDbId, scriptId)
  if (!script) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!script.fullText || !Array.isArray(script.sections) || script.sections.length === 0) {
    return NextResponse.json(
      { error: 'Generate or add a script before opening the AI Script Editor.' },
      { status: 400 }
    )
  }

  const [pending] = await db
    .select({ id: scriptEditMessages.id })
    .from(scriptEditMessages)
    .where(and(eq(scriptEditMessages.scriptId, scriptId), eq(scriptEditMessages.status, 'pending')))
    .limit(1)
  if (pending) {
    return NextResponse.json(
      { error: 'A proposed edit is already pending review. Accept or discard it before submitting a new instruction.' },
      { status: 409 }
    )
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
      instruction: parsed.data.instruction,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI edit failed. Please retry.' },
      { status: 502 }
    )
  }

  const { fullText } = wordsAndDuration(editResult.sections)

  const [message] = await db
    .insert(scriptEditMessages)
    .values({
      scriptId,
      organizationId: member.orgDbId,
      instruction: parsed.data.instruction,
      proposedSections: editResult.sections,
      proposedFullText: fullText,
      status: 'pending',
      modelUsed: 'gemini-flash-lite',
      tokensUsed: editResult.inputTokens + editResult.outputTokens,
      createdBy: member.userDbId,
    })
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

  return NextResponse.json(message, { status: 201 })
}
