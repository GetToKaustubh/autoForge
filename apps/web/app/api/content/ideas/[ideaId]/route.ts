import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videoIdeas } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite, canAdmin } from '@/lib/auth/get-member'

const patchSchema = z.object({
  title: z.string().min(3).max(300).optional(),
  hook: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  format: z.enum(['tutorial', 'review', 'listicle', 'vlog', 'documentary', 'shorts', 'live', 'comparison']).optional(),
  targetKeywords: z.array(z.string().max(100)).max(20).optional(),
  estimatedViewsMin: z.number().int().min(0).optional(),
  estimatedViewsMax: z.number().int().min(0).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  status: z.enum(['idea', 'approved', 'in_production', 'published', 'rejected', 'archived']).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })

async function getIdea(orgDbId: string, ideaId: string) {
  const [idea] = await db
    .select()
    .from(videoIdeas)
    .where(and(eq(videoIdeas.id, ideaId), eq(videoIdeas.organizationId, orgDbId)))
    .limit(1)
  return idea ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const { ideaId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const idea = await getIdea(member.orgDbId, ideaId)
  if (!idea) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(idea)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const { ideaId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const idea = await getIdea(member.orgDbId, ideaId)
  if (!idea) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Status transitions to 'approved'/'rejected' require admin
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { status } = parsed.data
  if ((status === 'approved' || status === 'rejected') && !canAdmin(member.role)) {
    return NextResponse.json({ error: 'Only admins can approve or reject ideas' }, { status: 403 })
  }

  const [updated] = await db
    .update(videoIdeas)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(videoIdeas.id, ideaId), eq(videoIdeas.organizationId, member.orgDbId)))
    .returning()

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const { ideaId } = await params
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member || !canAdmin(member.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [deleted] = await db
    .update(videoIdeas)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(videoIdeas.id, ideaId), eq(videoIdeas.organizationId, member.orgDbId)))
    .returning({ id: videoIdeas.id })

  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
