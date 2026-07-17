import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'

const patchSchema = z.object({
  title: z.string().min(3).max(300).optional(),
  sections: z.array(z.object({
    type: z.enum(['hook', 'intro', 'main', 'cta', 'outro']),
    content: z.string(),
    duration_sec: z.number().optional(),
    notes: z.string().optional(),
  })).optional(),
  fullText: z.string().optional(),
  status: z.enum(['draft', 'review', 'approved', 'in_production', 'archived']).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })

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

  return NextResponse.json(script)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  const { scriptId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const script = await getScript(member.orgDbId, scriptId)
  if (!script) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { sections, fullText, ...rest } = parsed.data
  const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() }

  if (sections !== undefined) {
    // Recompute every section's own duration from its current content rather
    // than keeping whatever was last stored - otherwise editing a section's
    // text in the editor leaves its duration badge showing the old length,
    // same "stale timestamp" bug fixed at generation time.
    const recomputed = sections.map((s) => ({
      ...s,
      duration_sec: Math.round(s.content.trim().split(/\s+/).filter(Boolean).length / 2.5),
    }))
    updateData.sections = recomputed
    const text = recomputed.map((s) => s.content).join('\n\n')
    updateData.fullText = fullText ?? text
    const wordCount = text.split(/\s+/).filter(Boolean).length
    updateData.wordCount = wordCount
    updateData.estimatedDurationSec = Math.round(wordCount / 2.5)
  } else if (fullText !== undefined) {
    updateData.fullText = fullText
    const wordCount = fullText.split(/\s+/).filter(Boolean).length
    updateData.wordCount = wordCount
    updateData.estimatedDurationSec = Math.round(wordCount / 2.5)
  }

  const [updated] = await db
    .update(scripts)
    .set(updateData)
    .where(and(eq(scripts.id, scriptId), eq(scripts.organizationId, member.orgDbId)))
    .returning()

  return NextResponse.json(updated)
}
