import { task, logger, tasks, runs } from '@trigger.dev/sdk'

interface WorkflowStep {
  id: string
  type: string
  config: Record<string, unknown>
  label?: string
}

export const workflowExecutionTask = task({
  id: 'workflow-execution',
  maxDuration: 3600,

  run: async (payload: { workflowRunId: string; workflowId: string; orgDbId: string }) => {
    const { workflowRunId, workflowId, orgDbId } = payload
    logger.info(`Starting workflow execution`, { workflowRunId, workflowId })

    const { db } = await import('../../lib/db')
    const { workflows, workflowRuns } = await import('../../lib/db/schema')
    const { eq } = await import('drizzle-orm')

    const [wf] = await db
      .select({ steps: workflows.steps })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1)

    if (!wf) {
      await db
        .update(workflowRuns)
        .set({ status: 'failed', error: 'Workflow not found', completedAt: new Date() })
        .where(eq(workflowRuns.id, workflowRunId))
      return { success: false, error: 'Workflow not found' }
    }

    const steps = wf.steps as WorkflowStep[]
    const stepResults: Record<string, { status: string; jobId?: string; error?: string; completedAt?: string }> = {}

    for (const step of steps) {
      logger.info(`Executing step`, { stepId: step.id, type: step.type })

      try {
        const handle = await tasks.trigger(step.type, {
          ...step.config,
          organizationId: orgDbId,
          workflowRunId,
        })

        stepResults[step.id] = { status: 'triggered', jobId: handle.id }

        // Persist step progress
        await db
          .update(workflowRuns)
          .set({ stepResults })
          .where(eq(workflowRuns.id, workflowRunId))

        // Wait for step to complete before running next
        const result = await runs.poll(handle.id)
        stepResults[step.id] = {
          status: result.isSuccess ? 'completed' : 'failed',
          jobId: handle.id,
          completedAt: new Date().toISOString(),
          ...(result.isSuccess ? {} : { error: result.error?.message ?? 'Unknown error' }),
        }

        if (!result.isSuccess) {
          logger.error(`Step failed`, { stepId: step.id, type: step.type })
          await db
            .update(workflowRuns)
            .set({
              status: 'failed',
              stepResults,
              error: `Step "${step.label ?? step.type}" failed`,
              completedAt: new Date(),
            })
            .where(eq(workflowRuns.id, workflowRunId))
          return { success: false, failedStep: step.id }
        }

        await db
          .update(workflowRuns)
          .set({ stepResults })
          .where(eq(workflowRuns.id, workflowRunId))
      } catch (err) {
        stepResults[step.id] = {
          status: 'failed',
          error: String(err),
          completedAt: new Date().toISOString(),
        }
        await db
          .update(workflowRuns)
          .set({
            status: 'failed',
            stepResults,
            error: `Step "${step.label ?? step.type}" threw: ${String(err)}`,
            completedAt: new Date(),
          })
          .where(eq(workflowRuns.id, workflowRunId))
        return { success: false, failedStep: step.id, error: String(err) }
      }
    }

    await db
      .update(workflowRuns)
      .set({ status: 'completed', stepResults, completedAt: new Date() })
      .where(eq(workflowRuns.id, workflowRunId))

    logger.info(`Workflow completed`, { workflowRunId, steps: steps.length })
    return { success: true, stepsCompleted: steps.length }
  },
})
