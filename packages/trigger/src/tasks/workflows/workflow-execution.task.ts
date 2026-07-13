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

  run: async (payload: { workflowRunId: string; workflowId: string; orgDbId: string; userDbId?: string }) => {
    const { workflowRunId, workflowId, orgDbId, userDbId } = payload
    logger.info(`Starting workflow execution`, { workflowRunId, workflowId })

    const { db } = await import('../../lib/db')
    const {
      workflows, workflowRuns, nicheResearch, keywordResearch, trends,
      scripts, voiceGenerations, thumbnails, seoOptimizations,
    } = await import('../../lib/db/schema')
    const { eq } = await import('drizzle-orm')

    // Most task types expect a placeholder row to already exist (created by
    // their normal API route, which does insert-then-trigger) and UPDATE it
    // by id rather than creating one - calling tasks.trigger directly on the
    // raw task type skips that insert entirely, so these would otherwise
    // fail immediately on "no such row". Mirror each route's insert here.
    async function preparePayload(step: WorkflowStep): Promise<Record<string, unknown>> {
      const base = { ...step.config, organizationId: orgDbId, userId: userDbId, workflowRunId }
      switch (step.type) {
        case 'niche-research': {
          const [row] = await db
            .insert(nicheResearch)
            .values({
              organizationId: orgDbId,
              channelId: (step.config.channelId as string) ?? null,
              createdBy: userDbId,
              query: step.config.query as string,
              modelUsed: 'gemini-flash-lite-latest',
              status: 'pending',
            })
            .returning({ id: nicheResearch.id })
          return { ...base, researchId: row!.id }
        }
        case 'keyword-research': {
          const [row] = await db
            .insert(keywordResearch)
            .values({
              organizationId: orgDbId,
              channelId: (step.config.channelId as string) ?? null,
              seedKeyword: step.config.seedKeyword as string,
              source: 'ai',
            })
            .returning({ id: keywordResearch.id })
          return { ...base, researchId: row!.id }
        }
        case 'trend-discovery': {
          const [row] = await db
            .insert(trends)
            .values({
              organizationId: orgDbId,
              channelId: (step.config.channelId as string) ?? null,
              topic: step.config.topic as string,
              source: 'ai',
            })
            .returning({ id: trends.id })
          return { ...base, trendId: row!.id }
        }
        case 'script-generation': {
          const [row] = await db
            .insert(scripts)
            .values({
              organizationId: orgDbId,
              channelId: step.config.channelId as string,
              ideaId: step.config.ideaId as string,
              createdBy: userDbId,
              title: (step.config.title as string) || 'Untitled',
              status: 'draft',
            })
            .returning({ id: scripts.id })
          return { ...base, scriptId: row!.id }
        }
        case 'voice-generation': {
          const [row] = await db
            .insert(voiceGenerations)
            .values({
              organizationId: orgDbId,
              scriptId: step.config.scriptId as string,
              createdBy: userDbId,
              voiceId: step.config.voiceId as string,
              voiceName: step.config.voiceId as string,
              voiceSettings: {},
              status: 'pending',
            })
            .returning({ id: voiceGenerations.id })
          return { ...base, voiceGenId: row!.id }
        }
        case 'thumbnail-generation': {
          const [row] = await db
            .insert(thumbnails)
            .values({
              organizationId: orgDbId,
              channelId: step.config.channelId as string,
              ideaId: (step.config.ideaId as string) || null,
              createdBy: userDbId,
              prompt: (step.config.thumbnailConcept as string) || (step.config.videoTitle as string),
              style: 'bold',
              status: 'pending',
            })
            .returning({ id: thumbnails.id })
          return { ...base, thumbnailId: row!.id }
        }
        case 'seo-optimization': {
          const [row] = await db
            .insert(seoOptimizations)
            .values({ organizationId: orgDbId, videoId: step.config.videoId as string })
            .onConflictDoUpdate({
              target: seoOptimizations.videoId,
              set: { updatedAt: new Date() },
            })
            .returning({ id: seoOptimizations.id })
          return { ...base, seoId: row!.id }
        }
        default:
          return base
      }
    }

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
        const stepPayload = await preparePayload(step)
        const handle = await tasks.trigger(step.type, stepPayload)

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
              error: `Step "${step.label || step.type}" failed`,
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
            error: `Step "${step.label || step.type}" threw: ${String(err)}`,
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
