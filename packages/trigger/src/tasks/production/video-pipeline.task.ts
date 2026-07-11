import { task, logger } from '@trigger.dev/sdk/v3'
import { z } from 'zod'

const videoPipelinePayloadSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().uuid(),
  voiceAudioUrl: z.string().url().optional(), // final merged audio
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
    const { v2: cloudinary } = await import('cloudinary')

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

    logger.info(`Concatenating ${scenes.length} scenes for video ${payload.videoId}`)

    // Build Cloudinary concatenation transformation
    // Use the first scene as base and chain the rest via fl_splice
    const basePublicId = scenes[0]!.cloudinary_public_id
    const additionalScenes = scenes.slice(1)

    type TransformationType = Record<string, unknown>
    const transformations: TransformationType[] = []

    // Add each additional scene via splice
    for (const scene of additionalScenes) {
      transformations.push({ flags: 'splice', overlay: `video:${scene.cloudinary_public_id.replace(/\//g, ':')}` })
      transformations.push({ flags: 'layer_apply' })
    }

    // Overlay voice audio if provided
    if (payload.voiceAudioUrl) {
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
