import { task, logger } from '@trigger.dev/sdk'
import { z } from 'zod'

const videoPipelinePayloadSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().uuid(),
  voiceAudioUrl: z.string().url().optional(), // final merged audio, overlaid once across the whole concatenated video
  // Veo autopilot path: each scene has its own dialogue clip, keyed by scene_index (as a string, since
  // this is a JSON payload) — paired with that scene's own video clip before concatenation instead of one
  // continuous track laid across the final video. Mutually exclusive with voiceAudioUrl.
  sceneAudioUrls: z.record(z.string(), z.string().url()).optional(),
  addCaptions: z.boolean().default(false),
  outputFormat: z.enum(['mp4']).default('mp4'),
})

export type VideoPipelinePayload = z.infer<typeof videoPipelinePayloadSchema>

export const videoPipelineTask = task({
  id: 'video-pipeline',
  maxDuration: 1800,
  retry: { maxAttempts: 2 },

  run: async (rawPayload: VideoPipelinePayload) => {
    const payload = videoPipelinePayloadSchema.parse(rawPayload)
    logger.info(`Starting video pipeline for ${payload.videoId}`)

    const { db } = await import('../../lib/db')
    const { videos } = await import('../../lib/db/schema')
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
      .set({ pipelineStage: 'editing' })
      .where(eq(videos.id, payload.videoId))

    // Fetch scene data from DB
    const [video] = await db
      .select({ scenes: videos.scenes, title: videos.title })
      .from(videos)
      .where(eq(videos.id, payload.videoId))
      .limit(1)

    if (!video) throw new Error(`Video ${payload.videoId} not found`)

    const scenes = (video.scenes as Array<{
      scene_index: number
      cloudinary_url: string
      cloudinary_public_id: string
      duration_sec: number
      status: string
    }>).filter((s) => s.status === 'completed' && s.cloudinary_public_id)

    if (scenes.length === 0) throw new Error('No completed scenes available for pipeline')

    // Sort by scene index
    scenes.sort((a, b) => a.scene_index - b.scene_index)

    // Veo autopilot path: bake each scene's own dialogue clip into that scene's
    // video BEFORE concatenation, so scene N plays with scene N's own audio
    // instead of one continuous track laid across the whole final video.
    let workingScenes = scenes
    if (payload.sceneAudioUrls) {
      logger.info(`Baking per-scene audio for ${scenes.length} scenes`)
      workingScenes = []
      for (const scene of scenes) {
        const audioUrl = payload.sceneAudioUrls[String(scene.scene_index)]
        const audioPublicId = audioUrl ? extractCloudinaryPublicId(audioUrl) : null
        if (!audioPublicId) {
          workingScenes.push(scene)
          continue
        }
        try {
          const baked = await cloudinary.uploader.explicit(scene.cloudinary_public_id, {
            type: 'upload',
            resource_type: 'video',
            eager: [{
              transformation: [
                { overlay: `video:${audioPublicId.replace(/\//g, ':')}`, flags: 'layer_apply', audio_codec: 'aac' },
              ],
              format: 'mp4',
            }],
            eager_async: false,
          })
          const eager = baked.eager?.[0] as { public_id?: string } | undefined
          workingScenes.push(eager?.public_id ? { ...scene, cloudinary_public_id: eager.public_id } : scene)
        } catch (err) {
          logger.info(`Scene ${scene.scene_index} audio bake failed, using silent clip: ${err instanceof Error ? err.message : String(err)}`)
          workingScenes.push(scene)
        }
      }
    }

    logger.info(`Concatenating ${workingScenes.length} scenes for video ${payload.videoId}`)

    // Build Cloudinary concatenation transformation
    // Use the first scene as base and chain the rest via fl_splice
    const basePublicId = workingScenes[0]!.cloudinary_public_id
    const additionalScenes = workingScenes.slice(1)

    type TransformationType = Record<string, unknown>
    const transformations: TransformationType[] = []

    // Add each additional scene via splice
    for (const scene of additionalScenes) {
      transformations.push({ flags: 'splice', overlay: `video:${scene.cloudinary_public_id.replace(/\//g, ':')}` })
      transformations.push({ flags: 'layer_apply' })
    }

    // Overlay one continuous voice track — only for the non-Veo path
    // (Veo scenes already have their own audio baked in per-clip above).
    if (payload.voiceAudioUrl && !payload.sceneAudioUrls) {
      const audioPublicId = extractCloudinaryPublicId(payload.voiceAudioUrl)
      if (audioPublicId) {
        transformations.push({
          overlay: `video:${audioPublicId.replace(/\//g, ':')}`,
          flags: 'layer_apply',
          audio_codec: 'aac',
        })
      }
    }

    // Add quality optimization
    transformations.push({ quality: 'auto', fetch_format: 'auto' })

    // Generate the transformed URL (Cloudinary lazy transformation — no server processing yet)
    const finalVideoUrl = cloudinary.url(basePublicId, {
      resource_type: 'video',
      transformation: transformations,
      format: 'mp4',
      secure: true,
    })

    // Trigger Cloudinary to eagerly process & store the result
    const folder = `tubeforge/${payload.organizationId}/videos/${payload.videoId}/final`

    let processedUrl = finalVideoUrl
    try {
      const eagerResult = await cloudinary.uploader.explicit(basePublicId, {
        type: 'upload',
        resource_type: 'video',
        eager: [{ transformation: transformations, format: 'mp4' }],
        eager_async: false,
      })

      const eager = eagerResult.eager?.[0] as { secure_url?: string } | undefined
      if (eager?.secure_url) {
        processedUrl = eager.secure_url
      }
    } catch (err) {
      // Non-fatal: URL still works via on-the-fly transformation
      logger.info(`Eager processing skipped: ${err instanceof Error ? err.message : String(err)}`)
    }

    const totalDurationSec = scenes.reduce((sum, s) => sum + s.duration_sec, 0)

    await db
      .update(videos)
      .set({
        pipelineStage: 'rendered',
        finalVideoUrl: processedUrl,
        durationSec: totalDurationSec,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, payload.videoId))

    logger.info(`Video pipeline ${payload.videoId} complete: ${totalDurationSec}s, ${scenes.length} scenes merged`)
    return { videoId: payload.videoId, finalVideoUrl: processedUrl, durationSec: totalDurationSec, sceneCount: scenes.length }
  },
})

function extractCloudinaryPublicId(url: string): string | null {
  // Extract public_id from Cloudinary URL
  // e.g. https://res.cloudinary.com/cloud/video/upload/v123/folder/file.mp3
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/)
  return match?.[1] ?? null
}
