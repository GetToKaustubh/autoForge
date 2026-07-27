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
    const { videos, scripts } = await import('../../lib/db/schema')
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
      .select({ scenes: videos.scenes, title: videos.title, scriptId: videos.scriptId })
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
      callout_text?: string
      callout_offset_sec?: number
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

    // Bold on-screen text callouts (explainer style) — timed against the FINAL
    // concatenated timeline, so each scene's cumulative start offset (based on
    // the original scene order/durations) plus its own callout_offset_sec
    // gives the absolute second the callout should appear. Displayed for 3s,
    // clamped so it never spills past its own scene's end.
    let cumulativeOffsetSec = 0
    for (const scene of scenes) {
      if (scene.callout_text) {
        const startOffset = cumulativeOffsetSec + (scene.callout_offset_sec ?? 0)
        const endOffset = Math.min(startOffset + 3, cumulativeOffsetSec + scene.duration_sec)
        transformations.push({
          overlay: { font_family: 'Arial', font_size: 70, font_weight: 'bold', text: scene.callout_text },
          color: 'white',
          gravity: 'center',
          start_offset: startOffset,
          end_offset: endOffset,
        })
        transformations.push({ flags: 'layer_apply' })
      }
      cumulativeOffsetSec += scene.duration_sec
    }

    // Burned-in captions — built from the script's own sections/durations, which
    // line up with the continuous per-section voice track (voiceAudioUrl). Not
    // supported for the Veo per-scene-audio path (sceneAudioUrls): that timeline
    // follows fixed 8s scene slots, not section durations, so section-based
    // caption timing would drift out of sync — skipped there rather than shipped
    // wrong.
    if (payload.addCaptions && !payload.sceneAudioUrls && video.scriptId) {
      const [script] = await db
        .select({ sections: scripts.sections })
        .from(scripts)
        .where(eq(scripts.id, video.scriptId))
        .limit(1)

      const sections = (script?.sections as Array<{ content: string; duration_sec: number }> | undefined) ?? []
      if (sections.length > 0) {
        const srt = buildSrt(sections)
        const folder = `tubeforge/${payload.organizationId}/videos/${payload.videoId}/captions`
        try {
          const srtUpload = await cloudinary.uploader.upload(`data:application/x-subrip;base64,${Buffer.from(srt).toString('base64')}`, {
            resource_type: 'raw',
            folder,
            public_id: 'captions',
            format: 'srt',
          })
          transformations.push({
            overlay: `subtitles:${srtUpload.public_id.replace(/\//g, ':')}.srt`,
            flags: 'layer_apply',
          })
        } catch (err) {
          logger.info(`Caption upload/overlay skipped: ${err instanceof Error ? err.message : String(err)}`)
        }
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

// One SRT cue per script section — coarser than word-level captions, but each
// cue's start/end lines up exactly with that section's slice of the single
// continuous voice track, which is the only timing data actually available.
function buildSrt(sections: Array<{ content: string; duration_sec: number }>): string {
  let cursorSec = 0
  const cues = sections.map((section, i) => {
    const start = cursorSec
    const end = cursorSec + section.duration_sec
    cursorSec = end
    return `${i + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${section.content.trim()}\n`
  })
  return cues.join('\n')
}

function formatSrtTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}
