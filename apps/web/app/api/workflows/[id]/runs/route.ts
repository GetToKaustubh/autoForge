import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { workflows, workflowRuns } from '@/lib/db/schema'
import { and, eq, desc, sql } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { tasks, TASK_IDS } from '@/lib/queue/client'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const runs = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, id), eq(workflowRuns.organizationId, member.orgDbId)))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(50)

  return NextResponse.json({ runs })
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member || !canWrite(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // Verify workflow belongs to org
  const [wf] = await db
    .select({ id: workflows.id, steps: workflows.steps, triggerType: workflows.triggerType })
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.organizationId, member.orgDbId)))
    .limit(1)

  if (!wf) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Create run record
  const [run] = await db
    .insert(workflowRuns)
    .values({
      organizationId: member.orgDbId,
      workflowId: wf.id,
      triggeredBy: member.userDbId,
      status: 'running',
      context: { triggeredManually: true },
      stepResults: {},
    })
    .returning()

  if (!run) return NextResponse.json({ error: 'Failed to create run' }, { status: 500 })

  // Trigger the execution task
  const handle = await tasks.trigger(TASK_IDS.WORKFLOW_EXECUTION, {
    workflowRunId: run.id,
    workflowId: wf.id,
    orgDbId: member.orgDbId,
  })

  // Update run with job ID
  await db
    .update(workflowRuns)
    .set({ triggerJobIds: [handle.id] })
    .where(eq(workflowRuns.id, run.id))

  // Update workflow last run time and increment count
  await db
    .update(workflows)
    .set({ runCount: sql`${workflows.runCount} + 1`, lastRunAt: new Date() })
    .where(eq(workflows.id, wf.id))

  return NextResponse.json({ run: { ...run, triggerJobIds: [handle.id] } }, { status: 201 })
}
