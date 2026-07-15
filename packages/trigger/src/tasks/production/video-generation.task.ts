import { task, logger } from '@trigger.dev/sdk'
import { z } from 'zod'
import type { v2 as CloudinaryV2 } from 'cloudinary'

const sceneSchema = z.object({
  scene_index: z.number().int(),
  prompt: z.string(),
  duration_sec: z.number().default(5),
  reference_image_url: z.string().url().optional(),
  // Per-scene provider override from the timeline editor's Visual Type
  // selector - 'auto'/omitted falls back to the video-level provider below.
  visual_type: z.enum(['auto', 'stock', 'ai-image', 'runway', 'pika', 'veo']).optional(),
})

const videoGenerationPayloadSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  scenes: z.array(sceneSchema).min(1).max(30),
  provider: z.enum(['stock', 'ai-image', 'runway', 'pika', 'veo']).default('stock'),
  model: z.enum(['gen3a_turbo', 'gen4_turbo']).default('gen3a_turbo'),
  aspectRatio: z.enum(['16:9', '9:16']).default('16:9'),
  // Veo-only: 1080p unlocks 8s scenes (720p caps at 6s) and costs more/sec.
  veoResolution: z.enum(['720p', '1080p']).default('720p'),
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
    const cloudinaryModule = await import('cloudinary')
    const cloudinary = (cloudinaryModule as unknown as { v2?: typeof cloudinaryModule.v2 }).v2
      ?? (cloudinaryModule as unknown as { default: { v2: typeof cloudinaryModule.v2 } }).default.v2

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
        const effectiveProvider =
          scene.visual_type && scene.visual_type !== 'auto' ? scene.visual_type : payload.provider

        let videoUrl: string

        if (effectiveProvider === 'stock') {
          videoUrl = await generateWithStockFootage(scene, cloudinary)
          // Pexels is free — cost stays 0
        } else if (effectiveProvider === 'ai-image') {
          videoUrl = await generateWithAIImage(scene, cloudinary, payload.aspectRatio)
          // Pollinations is free — cost stays 0
        } else if (effectiveProvider === 'runway') {
          videoUrl = await generateWithRunway(scene)
          totalCostUsd += estimateRunwayCost(scene.duration_sec)
        } else if (effectiveProvider === 'pika') {
          videoUrl = await generateWithPika(scene)
          totalCostUsd += estimatePikaCost(scene.duration_sec)
        } else {
          const veoDuration = clampVeoDuration(scene.duration_sec, payload.veoResolution, !!scene.reference_image_url)
          videoUrl = await generateWithVeo(scene, payload.aspectRatio, payload.veoResolution, veoDuration)
          totalCostUsd += estimateVeoCost(veoDuration, payload.veoResolution)
        }

        // Upload to Cloudinary
        const folder = `tubeforge/${payload.organizationId}/videos/${payload.videoId}/scenes`
        const publicId = `scene_${scene.scene_index}`

        // Normalize every scene to the same resolution (Cloudinary's splice concat
        // fails on mismatched clip sizes) and trim to the requested scene duration —
        // stock footage source clips run to whatever length the provider has, often
        // far longer than the scene's intended duration_sec, which otherwise makes
        // the final concatenated video much longer than the pipeline's own duration
        // estimate (sum of duration_sec) implies.
        const [normWidth, normHeight] = payload.aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080]
        const uploadResult = await cloudinary.uploader.upload(videoUrl, {
          resource_type: 'video',
          folder,
          public_id: publicId,
          format: 'mp4',
          transformation: [{ width: normWidth, height: normHeight, crop: 'fill', duration: scene.duration_sec }],
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
        // Cloudinary's SDK sometimes rejects with a plain {message, http_code}
        // object instead of an Error instance - String(plainObject) collapses
        // to the useless "[object Object]", hiding the real reason (confirmed
        // live: a scene failure gave no usable error at all).
        const error =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null
              ? JSON.stringify(err)
              : String(err)
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

    // api_service enum has no 'stock'/'ai-image' value (Pexels/Pollinations, would need a migration) — reuse 'cloudinary' as closest label
    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: payload.provider === 'stock' || payload.provider === 'ai-image' ? 'cloudinary' : payload.provider,
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

// Free stock footage via Pexels, matched to the scene's visual prompt.
// Falls back to a still photo animated with Cloudinary's Ken Burns (zoompan) effect
// when no matching stock video exists for the query.
async function generateWithStockFootage(scene: z.infer<typeof sceneSchema>, cloudinary: typeof CloudinaryV2): Promise<string> {
  const apiKey = process.env.PEXELS_API_KEY!
  const query = scene.prompt.slice(0, 100)

  const videoRes = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
    { headers: { Authorization: apiKey } },
  )
  if (!videoRes.ok) throw new Error(`Pexels video search failed: ${videoRes.status} — ${await videoRes.text()}`)
  const videoData = (await videoRes.json()) as {
    videos: Array<{ video_files: Array<{ link: string; width: number; height: number; quality: string }> }>
  }
  const match = videoData.videos[0]
  if (match) {
    const file = match.video_files.find((f) => f.quality === 'hd' && f.width >= 1280)
      ?? match.video_files.find((f) => f.width >= 1280)
      ?? match.video_files[0]
    if (file) return file.link
  }

  // No stock video match — fall back to a photo animated into a short zoom/pan clip
  const photoRes = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
    { headers: { Authorization: apiKey } },
  )
  if (!photoRes.ok) throw new Error(`Pexels photo search failed: ${photoRes.status} — ${await photoRes.text()}`)
  const photoData = (await photoRes.json()) as { photos: Array<{ src: { large2x: string } }> }
  const photoUrl = photoData.photos[0]?.src.large2x
  if (!photoUrl) throw new Error(`No Pexels video or photo found for prompt: "${scene.prompt}"`)

  const imgUpload = await cloudinary.uploader.upload(photoUrl, { resource_type: 'image' })
  return cloudinary.url(imgUpload.public_id, {
    resource_type: 'image',
    transformation: [{ effect: `zoompan:maxzoom_1.6;du_${Math.max(3, Math.round(scene.duration_sec))}` }],
    format: 'mp4',
    secure: true,
  })
}

// Free AI image generation via Pollinations.ai (Flux/SDXL, no API key) — same
// engine already used for thumbnails. Unlike stock footage, this actually
// renders the scene's own description instead of keyword-matching real-world
// photos, so a prompt like "ultra-realistic neon coastal city, fictional
// open-world game" produces something resembling that instead of a random
// real city photo. Animated with the same Ken Burns zoompan as the stock
// photo fallback above.
async function generateWithAIImage(
  scene: z.infer<typeof sceneSchema>,
  cloudinary: typeof CloudinaryV2,
  aspectRatio: '16:9' | '9:16'
): Promise<string> {
  const [width, height] = aspectRatio === '9:16' ? [768, 1365] : [1365, 768]
  const encoded = encodeURIComponent(scene.prompt.slice(0, 2000))
  const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${scene.scene_index}&nologo=true&enhance=true`

  const imgUpload = await cloudinary.uploader.upload(imageUrl, { resource_type: 'image' })
  return cloudinary.url(imgUpload.public_id, {
    resource_type: 'image',
    transformation: [{ effect: `zoompan:maxzoom_1.6;du_${Math.max(3, Math.round(scene.duration_sec))}` }],
    format: 'mp4',
    secure: true,
  })
}

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

// Veo 3.1 Lite only accepts 4, 6, or 8 second clips - 8s requires 1080p or a
// reference image (per Google's published spec), 720p caps at 6s. Snap the
// scene's requested duration to the nearest value actually allowed, rather
// than sending an arbitrary number and getting a 400 back after the scene
// already spent a slot in the loop.
function clampVeoDuration(requestedSec: number, resolution: '720p' | '1080p', hasReferenceImage: boolean): 4 | 6 | 8 {
  const allowed: Array<4 | 6 | 8> = resolution === '1080p' || hasReferenceImage ? [4, 6, 8] : [4, 6]
  return allowed.reduce((best, v) => (Math.abs(v - requestedSec) < Math.abs(best - requestedSec) ? v : best))
}

// Google's published per-second pricing for Veo 3.1 Lite (ai.google.dev/gemini-api/docs/pricing):
// $0.05/sec at 720p, $0.08/sec at 1080p. Paid tier only - no free quota.
function estimateVeoCost(durationSec: number, resolution: '720p' | '1080p'): number {
  return durationSec * (resolution === '1080p' ? 0.08 : 0.05)
}

// Veo 3.1 Lite generation is a long-running operation - submit, then poll
// ai.operations.getVideosOperation() until done (Google's docs: 11s min, up
// to ~6min at peak). Neither seed nor negativePrompt are supported by this
// model per its published spec (the SDK's config type is shared across all
// Veo versions, some of which do support them - sending them here would be
// silently ignored at best, so they're deliberately omitted). FPS is fixed
// at 24 by the model itself, not configurable.
async function generateWithVeo(
  scene: z.infer<typeof sceneSchema>,
  aspectRatio: '16:9' | '9:16',
  resolution: '720p' | '1080p',
  durationSeconds: 4 | 6 | 8
): Promise<string> {
  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! })

  // Veo's Image type only accepts a GCS URI or inline base64 bytes - our
  // reference_image_url is a plain Cloudinary HTTPS URL, so it has to be
  // fetched and inlined rather than passed through as-is.
  let referenceImage: { imageBytes: string; mimeType: string } | undefined
  if (scene.reference_image_url) {
    const imgRes = await fetch(scene.reference_image_url)
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer())
      referenceImage = {
        imageBytes: buf.toString('base64'),
        mimeType: imgRes.headers.get('content-type') ?? 'image/jpeg',
      }
    }
  }

  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-lite-generate-preview',
    prompt: scene.prompt,
    config: {
      aspectRatio,
      resolution,
      durationSeconds,
      numberOfVideos: 1,
      personGeneration: 'allow_adult',
      ...(referenceImage ? { image: referenceImage } : {}),
    },
  })

  const deadline = Date.now() + 600_000 // 10 min ceiling, above Google's documented ~6 min peak-hour max
  while (!operation.done) {
    if (Date.now() > deadline) throw new Error('Veo generation timed out')
    await new Promise((r) => setTimeout(r, 10_000))
    operation = await ai.operations.getVideosOperation({ operation })
  }

  if (operation.error) {
    throw new Error(`Veo generation failed: ${operation.error.message ?? JSON.stringify(operation.error)}`)
  }
  const generated = operation.response?.generatedVideos?.[0]
  if (!generated?.video) throw new Error('Veo succeeded but returned no video')

  const tmpPath = `/tmp/veo_${scene.scene_index}_${Date.now()}.mp4`
  await ai.files.download({ file: generated.video, downloadPath: tmpPath })
  return tmpPath
}
