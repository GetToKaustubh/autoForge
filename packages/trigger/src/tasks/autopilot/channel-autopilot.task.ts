import { task, logger, tasks, runs, schedules } from '@trigger.dev/sdk'
import { z } from 'zod'
import { randomBytes } from 'crypto'

const channelAutopilotPayloadSchema = z.object({
  channelId: z.string().uuid(),
})

// Autopilot's default shared voice across every scene/section — no per-character
// voice casting yet (flagged as a follow-up; scene planning already knows each
// scene's characterName and could map to different voice ids fairly cheaply).
const DEFAULT_VOICE_ID = 'en-US-AriaNeural'

export const channelAutopilotTask = task({
  id: 'channel-autopilot',
  maxDuration: 3600,
  retry: { maxAttempts: 1 }, // no blind retry — re-running from step 1 would duplicate an idea/script/video that already exists

  run: async (rawPayload: { channelId: string }) => {
    const payload = channelAutopilotPayloadSchema.parse(rawPayload)
    logger.info(`Starting channel autopilot for ${payload.channelId}`)

    const { db } = await import('../../lib/db')
    const {
      youtubeChannels, users, workflows, workflowRuns, channelAutopilotRuns,
      videoIdeas, scripts, voiceGenerations, thumbnails, videos, seoOptimizations, apiUsage,
    } = await import('../../lib/db/schema')
    const { eq, sql, inArray } = await import('drizzle-orm')
    const { planVeoScenes, planStockScenes } = await import('../../lib/services/scene-planning')
    const { generateWithGeminiImage } = await import('../../lib/services/gemini-image')
    const cloudinaryModule = await import('cloudinary')
    const cloudinary = (cloudinaryModule as unknown as { v2?: typeof cloudinaryModule.v2 }).v2
      ?? (cloudinaryModule as unknown as { default: { v2: typeof cloudinaryModule.v2 } }).default.v2

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    })

    const [channel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.id, payload.channelId)).limit(1)
    if (!channel) {
      logger.info(`Channel ${payload.channelId} not found, aborting`)
      return { success: false, skipped: true, reason: 'channel_not_found' }
    }

    // Note: autopilotEnabled itself is deliberately NOT checked here — the
    // schedule-fired path checks it in autopilot-schedule.task.ts before
    // forwarding, so the manual "Run once now" route can still exercise this
    // exact task ahead of ever enabling the real schedule (see the plan's
    // verification steps). channel.status still gates both paths — a
    // disconnected/quota-exceeded channel shouldn't run either way.
    if (channel.status !== 'active') {
      logger.info(`Channel ${payload.channelId} not active (status=${channel.status}), skipping`)
      return { success: false, skipped: true, reason: 'channel_not_active' }
    }
    if (!channel.autopilotNichePrompt) {
      logger.info(`No niche prompt set for ${payload.channelId}, skipping`)
      return { success: false, skipped: true, reason: 'no_niche_prompt' }
    }

    // Quota pre-flight: skip (not fail) if there isn't even room for one upload today.
    const quotaRemaining = channel.quotaLimitDaily - channel.quotaUsedToday
    if (quotaRemaining < 1600) {
      logger.info(`Quota exhausted for ${payload.channelId}: ${quotaRemaining} remaining`)
      return { success: false, skipped: true, reason: 'quota_exhausted' }
    }

    const provider = channel.autopilotProvider as 'stock' | 'ai-image' | 'runway' | 'pika' | 'veo'
    const mode = channel.autopilotMode as 'review' | 'auto'
    const isVeo = provider === 'veo'
    const userId = channel.connectedBy

    // 3. Workflow bookkeeping — reuses the same workflows/workflowRuns tables
    // manual Workflows already writes into, so autopilot runs show up wherever
    // workflow history is already surfaced.
    let [workflow] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(eq(workflows.channelId, payload.channelId))
      .limit(1)
    if (!workflow) {
      const [created] = await db
        .insert(workflows)
        .values({
          organizationId: channel.organizationId,
          channelId: payload.channelId,
          createdBy: userId,
          name: `Autopilot: ${channel.channelName}`,
          triggerType: 'scheduled',
          steps: [],
        })
        .returning({ id: workflows.id })
      workflow = created!
    }

    const [workflowRun] = await db
      .insert(workflowRuns)
      .values({ organizationId: channel.organizationId, workflowId: workflow.id, status: 'running' })
      .returning({ id: workflowRuns.id })

    const [autopilotRun] = await db
      .insert(channelAutopilotRuns)
      .values({
        organizationId: channel.organizationId,
        channelId: payload.channelId,
        workflowRunId: workflowRun!.id,
        status: 'running',
        stage: 'idea',
      })
      .returning({ id: channelAutopilotRuns.id })
    const runId = autopilotRun!.id

    async function setStage(stage: string) {
      await db.update(channelAutopilotRuns).set({ stage }).where(eq(channelAutopilotRuns.id, runId))
    }

    async function pollAndCheck(handleId: string, stepLabel: string) {
      const result = await runs.poll(handleId)
      if (!result.isSuccess) {
        throw new Error(`${stepLabel} failed: ${result.error?.message ?? 'unknown error'}`)
      }
      return result.output as Record<string, unknown>
    }

    try {
      // 4. Idea
      await setStage('idea')
      const ideaHandle = await tasks.trigger('idea-generation', {
        channelId: payload.channelId,
        organizationId: channel.organizationId,
        userId,
        niche: channel.autopilotNichePrompt,
        count: 1,
        format: channel.autopilotFormat || undefined,
        targetAudience: channel.autopilotTargetAudience || undefined,
      })
      const ideaOutput = await pollAndCheck(ideaHandle.id, 'Idea generation')
      const ideaId = (ideaOutput.ideaIds as string[])[0]
      if (!ideaId) throw new Error('Idea generation produced no idea')
      await db.update(channelAutopilotRuns).set({ ideaId }).where(eq(channelAutopilotRuns.id, runId))

      const [idea] = await db.select().from(videoIdeas).where(eq(videoIdeas.id, ideaId)).limit(1)
      if (!idea) throw new Error(`Idea ${ideaId} not found after generation`)

      // 5. Script
      await setStage('script')
      const [scriptRow] = await db
        .insert(scripts)
        .values({
          organizationId: channel.organizationId,
          channelId: payload.channelId,
          ideaId,
          createdBy: userId,
          title: idea.title,
          status: 'draft',
        })
        .returning({ id: scripts.id })
      const scriptId = scriptRow!.id
      await db.update(channelAutopilotRuns).set({ scriptId }).where(eq(channelAutopilotRuns.id, runId))

      const scriptHandle = await tasks.trigger('script-generation', {
        scriptId,
        ideaId,
        organizationId: channel.organizationId,
      })
      await pollAndCheck(scriptHandle.id, 'Script generation')

      const [script] = await db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1)
      if (!script?.fullText) throw new Error('Script generation completed but produced no text')

      // 6-7. Scene planning (+ reference images for Veo)
      await setStage('scenes')
      type PipelineScene = { scene_index: number; prompt: string; duration_sec: number; reference_image_url?: string }
      let pipelineScenes: PipelineScene[]
      // Per-scene dialogue, keyed by scene_index — only populated for the Veo path,
      // consumed by the voice + render steps below to pair scene N's own audio with
      // scene N's own video clip instead of one continuous narration track.
      let sceneDialogue: Map<number, { characterName: string; dialogueText: string }> | null = null

      if (isVeo) {
        const veoScenes = await planVeoScenes({
          scriptFullText: script.fullText,
          nichePrompt: channel.autopilotNichePrompt,
        })
        sceneDialogue = new Map(veoScenes.map((s) => [s.scene_index, { characterName: s.characterName, dialogueText: s.dialogueText }]))

        const folder = `tubeforge/${channel.organizationId}/autopilot/${runId}/refs`
        pipelineScenes = []
        for (const scene of veoScenes) {
          const refUrl = await generateWithGeminiImage(
            `${scene.imagePrompt}. Character reference image, clean background.`,
            'imagen-fast', cloudinary, folder, `scene_${scene.scene_index}`
          )
          pipelineScenes.push({
            scene_index: scene.scene_index,
            prompt: scene.animationPrompt,
            duration_sec: scene.duration_sec,
            reference_image_url: refUrl,
          })
        }
      } else {
        const stockScenes = await planStockScenes({
          scriptFullText: script.fullText,
          totalDurationSec: script.estimatedDurationSec ?? 180,
        })
        pipelineScenes = stockScenes
      }

      // 8. Video
      await setStage('video')
      const isShort = idea.format === 'shorts'
      const [videoRow] = await db
        .insert(videos)
        .values({
          organizationId: channel.organizationId,
          channelId: payload.channelId,
          scriptId,
          createdBy: userId,
          title: idea.title,
          description: idea.description,
          contentType: isShort ? 'short' : 'video',
          ytVisibility: 'public',
        })
        .returning({ id: videos.id })
      const videoId = videoRow!.id
      await db.update(channelAutopilotRuns).set({ videoId }).where(eq(channelAutopilotRuns.id, runId))

      const videoHandle = await tasks.trigger('video-generation', {
        videoId,
        organizationId: channel.organizationId,
        channelId: payload.channelId,
        scenes: pipelineScenes,
        provider,
        aspectRatio: isShort ? '9:16' : '16:9',
        veoResolution: '720p',
      })
      await pollAndCheck(videoHandle.id, 'Video generation')

      // 9. Voice — per scene for Veo, per section (existing behavior) otherwise
      await setStage('voice')
      let voiceGenId: string
      let sceneAudioUrls: Record<string, string> | undefined

      if (isVeo && sceneDialogue) {
        const [voiceRow] = await db
          .insert(voiceGenerations)
          .values({
            organizationId: channel.organizationId,
            scriptId,
            createdBy: userId,
            voiceId: DEFAULT_VOICE_ID,
            voiceName: DEFAULT_VOICE_ID,
            status: 'processing',
          })
          .returning({ id: voiceGenerations.id })
        voiceGenId = voiceRow!.id

        const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts')
        const sectionResults: Array<{ section_index: number; cloudinary_url: string; duration_sec: number; characters_used: number }> = []
        sceneAudioUrls = {}
        let totalChars = 0
        let totalDurationSec = 0

        for (const [sceneIndex, dialogue] of Array.from(sceneDialogue.entries()).sort((a, b) => a[0] - b[0])) {
          const tts = new MsEdgeTTS()
          await tts.setMetadata(DEFAULT_VOICE_ID, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
          const { audioStream } = tts.toStream(dialogue.dialogueText)
          const chunks: Buffer[] = []
          for await (const chunk of audioStream) chunks.push(chunk as Buffer)
          tts.close()
          const audioBuffer = Buffer.concat(chunks)

          const uploadResult = await new Promise<{ secure_url: string; duration?: number }>((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              { resource_type: 'video', folder: `tubeforge/${channel.organizationId}/voice/${voiceGenId}`, public_id: `scene_${sceneIndex}`, format: 'mp3' },
              (error, result) => (error || !result ? reject(error) : resolve(result))
            ).end(audioBuffer)
          })

          const duration = uploadResult.duration ?? dialogue.dialogueText.length / 15
          totalChars += dialogue.dialogueText.length
          totalDurationSec += duration
          sceneAudioUrls[String(sceneIndex)] = uploadResult.secure_url
          sectionResults.push({ section_index: sceneIndex, cloudinary_url: uploadResult.secure_url, duration_sec: duration, characters_used: dialogue.dialogueText.length })
        }

        await db
          .update(voiceGenerations)
          .set({ sections: sectionResults, totalChars, totalDurationSec, status: 'completed', completedAt: new Date() })
          .where(eq(voiceGenerations.id, voiceGenId))

        await db.insert(apiUsage).values({
          organizationId: channel.organizationId, service: 'elevenlabs', endpoint: 'text-to-speech',
          unitsUsed: totalChars.toString(), unitType: 'chars', costUsd: '0.000000',
          resourceType: 'voice_generation', resourceId: voiceGenId,
        })
      } else {
        const [voiceRow] = await db
          .insert(voiceGenerations)
          .values({
            organizationId: channel.organizationId,
            scriptId,
            createdBy: userId,
            voiceId: DEFAULT_VOICE_ID,
            voiceName: DEFAULT_VOICE_ID,
            status: 'pending',
          })
          .returning({ id: voiceGenerations.id })
        voiceGenId = voiceRow!.id

        const voiceHandle = await tasks.trigger('voice-generation', {
          voiceGenId, scriptId, organizationId: channel.organizationId, voiceId: DEFAULT_VOICE_ID, pace: 'normal',
        })
        await pollAndCheck(voiceHandle.id, 'Voice generation')
      }

      await db.update(videos).set({ voiceGenId }).where(eq(videos.id, videoId))

      const [voiceGen] = await db.select({ fullAudioUrl: voiceGenerations.fullAudioUrl }).from(voiceGenerations).where(eq(voiceGenerations.id, voiceGenId)).limit(1)

      // 10. Thumbnail
      await setStage('thumbnail')
      const [thumbnailRow] = await db
        .insert(thumbnails)
        .values({
          organizationId: channel.organizationId,
          channelId: payload.channelId,
          ideaId,
          createdBy: userId,
          prompt: idea.description || idea.title,
          style: 'bold',
          status: 'pending',
        })
        .returning({ id: thumbnails.id })
      const thumbnailId = thumbnailRow!.id

      const thumbnailHandle = await tasks.trigger('thumbnail-generation', {
        thumbnailId,
        videoTitle: idea.title,
        thumbnailConcept: idea.description ?? undefined,
        organizationId: channel.organizationId,
        userId,
        variantCount: 1,
        model: isVeo ? 'imagen-fast' : 'pollinations',
      })
      const thumbnailOutput = await pollAndCheck(thumbnailHandle.id, 'Thumbnail generation')
      await db.update(videos).set({ thumbnailId }).where(eq(videos.id, videoId))

      // 11. Render
      await setStage('render')
      const pipelineHandle = await tasks.trigger('video-pipeline', {
        videoId,
        organizationId: channel.organizationId,
        ...(isVeo ? { sceneAudioUrls } : { voiceAudioUrl: voiceGen?.fullAudioUrl ?? undefined }),
        addCaptions: false,
      })
      await pollAndCheck(pipelineHandle.id, 'Video pipeline')

      // 12. SEO
      await setStage('seo')
      const [seoRow] = await db
        .insert(seoOptimizations)
        .values({ organizationId: channel.organizationId, videoId })
        .onConflictDoUpdate({ target: seoOptimizations.videoId, set: { updatedAt: new Date() } })
        .returning({ id: seoOptimizations.id })
      const seoId = seoRow!.id

      const seoHandle = await tasks.trigger('seo-optimization', {
        videoId,
        seoId,
        organizationId: channel.organizationId,
        currentTitle: idea.title,
        currentDescription: idea.description ?? undefined,
        currentTags: idea.targetKeywords ?? undefined,
        targetKeywords: idea.targetKeywords ?? undefined,
        channelNiche: channel.autopilotNichePrompt,
      })
      await pollAndCheck(seoHandle.id, 'SEO optimization')

      // Cost rollup — sum every apiUsage row this run's resources produced.
      const resourceIds = [ideaId, scriptId, videoId, voiceGenId, thumbnailId, seoId].filter(Boolean) as string[]
      const [costRow] = await db
        .select({ total: sql<string>`coalesce(sum(${apiUsage.costUsd}), 0)` })
        .from(apiUsage)
        .where(inArray(apiUsage.resourceId, resourceIds))
      const costUsd = costRow?.total ?? '0'

      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const thumbUrl = (thumbnailOutput.selectedUrl as string | undefined)

      // 13. Publish decision
      if (mode === 'auto') {
        await setStage('publish')
        const uploadHandle = await tasks.trigger('youtube-upload', { videoId, channelId: payload.channelId, organizationId: channel.organizationId })
        const uploadOutput = await pollAndCheck(uploadHandle.id, 'YouTube upload')

        if (user) {
          await tasks.trigger('send-notification', {
            to: user.email,
            type: 'upload_success',
            data: { videoTitle: idea.title, channelName: channel.channelName, ytUrl: uploadOutput.ytUrl as string },
          })
        }

        await db
          .update(channelAutopilotRuns)
          .set({ status: 'completed', stage: 'done', costUsd, completedAt: new Date() })
          .where(eq(channelAutopilotRuns.id, runId))
      } else {
        const approvalToken = randomBytes(32).toString('hex')
        const approvalTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

        await db
          .update(channelAutopilotRuns)
          .set({ status: 'awaiting_review', stage: 'awaiting_review', costUsd, approvalToken, approvalTokenExpiresAt })
          .where(eq(channelAutopilotRuns.id, runId))

        if (user) {
          await tasks.trigger('send-notification', {
            to: user.email,
            type: 'review_needed',
            data: {
              videoTitle: idea.title,
              channelName: channel.channelName,
              thumbnailUrl: thumbUrl ?? '',
              approveUrl: `${appUrl}/api/autopilot/approve?token=${approvalToken}&action=approve`,
              rejectUrl: `${appUrl}/api/autopilot/approve?token=${approvalToken}&action=reject`,
            },
          })
        }
      }

      await db
        .update(workflowRuns)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(workflowRuns.id, workflowRun!.id))

      await db
        .update(youtubeChannels)
        .set({ autopilotLastRunAt: new Date(), autopilotConsecutiveFailures: 0 })
        .where(eq(youtubeChannels.id, payload.channelId))

      logger.info(`Channel autopilot ${payload.channelId} completed: mode=${mode}, videoId=${videoId}`)
      return { success: true, videoId, mode }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error(`Channel autopilot ${payload.channelId} failed: ${errorMessage}`)

      await db
        .update(channelAutopilotRuns)
        .set({ status: 'failed', errorMessage, completedAt: new Date() })
        .where(eq(channelAutopilotRuns.id, runId))
      await db
        .update(workflowRuns)
        .set({ status: 'failed', error: errorMessage, completedAt: new Date() })
        .where(eq(workflowRuns.id, workflowRun!.id))

      const newFailureCount = channel.autopilotConsecutiveFailures + 1
      await db
        .update(youtubeChannels)
        .set({ autopilotLastRunAt: new Date(), autopilotConsecutiveFailures: newFailureCount })
        .where(eq(youtubeChannels.id, payload.channelId))

      if (newFailureCount >= 3) {
        await db
          .update(youtubeChannels)
          .set({ autopilotEnabled: false })
          .where(eq(youtubeChannels.id, payload.channelId))

        if (channel.autopilotScheduleId) {
          await schedules.deactivate(channel.autopilotScheduleId).catch(() => {})
        }

        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
        if (user) {
          await tasks.trigger('send-notification', {
            to: user.email,
            type: 'pipeline_failed',
            data: {
              videoTitle: `Autopilot for ${channel.channelName}`,
              failedStage: 'autopilot (3 consecutive failures — autopilot disabled)',
              errorMessage,
              dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/channels/${payload.channelId}/settings`,
            },
          })
        }
      }

      return { success: false, error: errorMessage }
    }
  },
})
