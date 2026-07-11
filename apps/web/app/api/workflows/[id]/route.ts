import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { workflows } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { z } from 'zod'

const PatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  steps: z.array(z.record(z.unknown())).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
}).strict()

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.organizationId, member.orgDbId)))
    .limit(1)

  if (!wf) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ workflow: wf })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member || !canWrite(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json() as unknown
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const [updated] = await db
    .update(workflows)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(workflows.id, id), eq(workflows.organizationId, member.orgDbId)))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ workflow: updated })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member || !canWrite(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const [deleted] = await db
    .delete(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.organizationId, member.orgDbId)))
    .returning({ id: workflows.id })

  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
