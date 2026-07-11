import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { workflows } from '@/lib/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { z } from 'zod'

const StepSchema = z.object({
  id: z.string(),
  type: z.enum([
    'niche-research', 'keyword-research', 'trend-discovery',
    'idea-generation', 'script-generation', 'voice-generation',
    'thumbnail-generation', 'video-generation', 'seo-optimization',
    'youtube-upload', 'send-notification',
  ]),
  config: z.record(z.unknown()).default({}),
  label: z.string().optional(),
})

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  triggerType: z.enum(['manual', 'scheduled', 'on_idea_approved', 'on_script_approved', 'webhook']),
  triggerConfig: z.record(z.unknown()).default({}),
  steps: z.array(StepSchema).min(1),
  channelId: z.string().uuid().optional(),
})

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const list = await db
    .select()
    .from(workflows)
    .where(eq(workflows.organizationId, member.orgDbId))
    .orderBy(desc(workflows.createdAt))

  return NextResponse.json({ workflows: list })
}

export async function POST(request: Request) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member || !canWrite(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as unknown
  const parsed = CreateWorkflowSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, description, triggerType, triggerConfig, steps, channelId } = parsed.data

  const [created] = await db
    .insert(workflows)
    .values({
      organizationId: member.orgDbId,
      createdBy: member.userDbId,
      name,
      description,
      triggerType,
      triggerConfig,
      steps,
      channelId: channelId ?? null,
    })
    .returning()

  return NextResponse.json({ workflow: created }, { status: 201 })
}
