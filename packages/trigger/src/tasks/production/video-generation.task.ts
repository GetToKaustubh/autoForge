import { task, logger } from '@trigger.dev/sdk/v3'
import { z } from 'zod'

const sceneSchema = z.object({
  scene_index: z.number().int(),
  prompt: z.string(),
  duration_sec: z.number().default(5),
  reference_image_url: z.string().url().optional(),
})

const videoGenerationPayloadSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  scenes: z.array(sceneSchema).min(1).max(30),
  provider: z.enum(['runway', 'pika']).default('runway'),
  model: z.enum(['gen3a_turbo', 'gen4_turbo']).default('gen3a_turbo'),
})

export type VideoGenerationPayload = z.infer<typeof videoGenerationPayloadSchema>

export const videoGenerationTask = task({
  id: 'video-generation',
  maxDuration: 1800, // 30 min for up to 30 scenes
  retry: { maxAttempts: 2 },

  run: async (rawPayload: VideoGenerationPayload) => {
    const payload = videoGenerationPayloadSchema.parse(rawPayload)
    logger.info(`Starting video generation for ${payload.videoId}: ${payload.scenes.length} scenes via ${payload.provider}`)

    const { db } = await import('../../lib/db')
    const { videos, apiUsage } = await import('../../lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const { v2: cloudinary } = await import('cloudinary')

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
      api_key: process.env.CLOUDINARY_API_KEY!,
      api_secret: process.env.CLOUDINARY_API_SECRET!,
      secure: true,
    })

    await db
      .update(videos)
      .set({ pipelineStage: 'scenes_generating' })
      .where(eq(videos.id, payload.videoId))

    const sceneResults: Array<{
      scene_index: number
      cloudinary_url: string
      cloudinary_public_id: string
      duration_sec: number
      runway_job_id?: string
      status: 'completed' | 'failed'
      error?: string
    }> = []

    let totalCostUsd = 0

    for (const scene of payload.scenes) {
      logger.info(`Generating scene ${scene.scene_index + 1}/${payload.scenes.length}`)

      try {
        let videoUrl: string

        if (payload.provider === 'runway') {
          videoUrl = await generateWithRunway(scene)
          totalCostUsd += estimateRunwayCost(scene.duration_sec)
        } else {
          videoUrl = await generateWithPika(scene)
          totalCostUsd += estimatePikaCost(scene.duration_sec)
        }

        // Upload to Cloudinary
        const folder = `tubeforge/${payload.organizationId}/videos/${payload.videoId}/scenes`
        const publicId = `scene_${scene.scene_index}`

        const uploadResult = await cloudinary.uploader.upload(videoUrl, {
          resource_type: 'video',
          folder,
          public_id: publicId,
          format: 'mp4',
        })

        sceneResults.push({
          scene_index: scene.scene_index,
          cloudinary_url: uploadResult.secure_url,
          cloudinary_public_id: uploadResult.public_id,
          duration_sec: scene.duration_sec,
          status: 'completed',
        })

        logger.info(`Scene ${scene.scene_index} completed: ${uploadResult.secure_url}`)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        logger.info(`Scene ${scene.scene_index} failed: ${error}`)
        sceneResults.push({
          scene_index: scene.scene_index,
          cloudinary_url: '',
          cloudinary_public_id: '',
          duration_sec: scene.duration_sec,
          status: 'failed',
          error,
        })
      }

      // Update progress in DB after each scene
      await db
        .update(videos)
        .set({ scenes: sceneResults })
        .where(eq(videos.id, payload.videoId))
    }

    const failedScenes = sceneResults.filter((s) => s.status === 'failed').length
    const completedScenes = sceneResults.filter((s) => s.status === 'completed').length

    if (completedScenes === 0) {
      await db
        .update(videos)
        .set({ pipelineStage: 'failed', scenes: sceneResults })
        .where(eq(videos.id, payload.videoId))
      throw new Error('All scenes failed to generate')
    }

    await db
      .update(videos)
      .set({ pipelineStage: 'scenes_ready', scenes: sceneResults })
      .where(eq(videos.id, payload.videoId))

    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: payload.provider,
      endpoint: 'video-generation',
      unitsUsed: String(completedScenes),
      unitType: 'scenes',
      costUsd: totalCostUsd.toFixed(6),
      resourceType: 'video',
      resourceId: payload.videoId,
    })

    logger.info(`Video generation ${payload.videoId} done: ${completedScenes} scenes, ${failedScenes} failed, $${totalCostUsd.toFixed(2)}`)
    return { videoId: payload.videoId, completedScenes, failedScenes, totalCostUsd }
  },
})

async function generateWithRunway(scene: z.infer<typeof sceneSchema>): Promise<string> {
  const body: Record<string, unknown> = {
    model: 'gen3a_turbo',
    promptText: scene.prompt,
    duration: scene.duration_sec <= 5 ? 5 : 10,
    ratio: '1280:768',
    watermark: false,
  }
  if (scene.reference_image_url) {
    body.promptImage = scene.reference_image_url
  }

  const res = await fetch('https://api.runwayml.com/v1/image_to_video', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RUNWAY_API_KEY!}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Runway failed: ${res.status} — ${err}`)
  }

  const { id: generationId } = (await res.json()) as { id: string }

  // Poll until done (max 10 min per scene)
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000))

    const poll = await fetch(`https://api.runwayml.com/v1/tasks/${generationId}`, {
      headers: {
        Authorization: `Bearer ${process.env.RUNWAY_API_KEY!}`,
        'X-Runway-Version': '2024-11-06',
      },
    })
    const gen = (await poll.json()) as { status: string; output?: string[]; failure?: string }

    if (gen.status === 'SUCCEEDED') {
      const url = gen.output?.[0]
      if (!url) throw new Error('Runway succeeded but returned no URL')
      return url
    }
    if (gen.status === 'FAILED') {
      throw new Error(`Runway generation failed: ${gen.failure ?? 'unknown'}`)
    }
  }

  throw new Error('Runway generation timed out')
}

async function generateWithPika(scene: z.infer<typeof sceneSchema>): Promise<string> {
  // Pika Labs API (v2) — submit and poll
  const res = await fetch('https://api.pika.art/v2/generate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PIKA_API_KEY!}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      promptText: scene.prompt,
      duration: scene.duration_sec,
      aspectRatio: '16:9',
      ...(scene.reference_image_url ? { image: scene.reference_image_url } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pika failed: ${res.status} — ${err}`)
  }

  const { id: jobId } = (await res.json()) as { id: string }

  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000))

    const poll = await fetch(`https://api.pika.art/v2/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${process.env.PIKA_API_KEY!}` },
    })
    const job = (await poll.json()) as { status: string; videos?: Array<{ url: string }>; error?: string }

    if (job.status === 'completed') {
      const url = job.videos?.[0]?.url
      if (!url) throw new Error('Pika completed but no video URL')
      return url
    }
    if (job.status === 'failed') {
      throw new Error(`Pika generation failed: ${job.error ?? 'unknown'}`)
    }
  }

  throw new Error('Pika generation timed out')
}

function estimateRunwayCost(durationSec: number): number {
  return durationSec * 0.05 // ~$0.05/sec
}

function estimatePikaCost(durationSec: number): number {
  return durationSec * 0.04 // ~$0.04/sec
}
