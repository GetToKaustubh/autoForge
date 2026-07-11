import { task, logger } from '@trigger.dev/sdk'
import { z } from 'zod'

const voicePayloadSchema = z.object({
  voiceGenId: z.string().uuid(),
  scriptId: z.string().uuid(),
  organizationId: z.string().uuid(),
  voiceId: z.string(),
  voiceSettings: z.object({
    stability: z.number().default(0.5),
    similarityBoost: z.number().default(0.75),
    style: z.number().default(0),
    useSpeakerBoost: z.boolean().default(true),
  }).default({}),
})

export type VoiceGenerationPayload = z.infer<typeof voicePayloadSchema>

export const voiceGenerationTask = task({
  id: 'voice-generation',
  maxDuration: 600,
  retry: { maxAttempts: 2 },

  run: async (rawPayload: VoiceGenerationPayload) => {
    const payload = voicePayloadSchema.parse(rawPayload)
    logger.info(`Starting voice generation for ${payload.voiceGenId}`)

    const { db } = await import('../../lib/db')
    const { scripts, voiceGenerations, apiUsage } = await import('../../lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const { v2: cloudinary } = await import('cloudinary')

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    })

    // Mark as processing
    await db
      .update(voiceGenerations)
      .set({ status: 'processing' })
      .where(eq(voiceGenerations.id, payload.voiceGenId))

    // Fetch script sections
    const [script] = await db
      .select({ sections: scripts.sections })
      .from(scripts)
      .where(eq(scripts.id, payload.scriptId))
      .limit(1)

    if (!script) throw new Error(`Script ${payload.scriptId} not found`)

    const sections = script.sections as Array<{
      type: string; content: string; duration_sec: number
    }>

    let totalChars = 0
    let totalDurationSec = 0
    const sectionResults: Array<{
      section_index: number
      cloudinary_url: string
      duration_sec: number
      characters_used: number
    }> = []

    // Generate audio per section sequentially (ElevenLabs rate limits)
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      if (!section) continue
      const text = section.content
      const charCount = text.length
      totalChars += charCount

      logger.info(`Generating section ${i} audio: ${charCount} chars`)

      // Call ElevenLabs TTS API
      const ttsResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${payload.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVENLABS_API_KEY!,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: payload.voiceSettings.stability,
              similarity_boost: payload.voiceSettings.similarityBoost,
              style: payload.voiceSettings.style,
              use_speaker_boost: payload.voiceSettings.useSpeakerBoost,
            },
          }),
        }
      )

      if (!ttsResponse.ok) {
        const error = await ttsResponse.text()
        throw new Error(`ElevenLabs error for section ${i}: ${error}`)
      }

      const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer())

      // Upload to Cloudinary
      const uploadResult = await new Promise<{ secure_url: string; duration?: number }>(
        (resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              resource_type: 'video', // audio files use resource_type: video in Cloudinary
              folder: `tubeforge/${payload.organizationId}/voice/${payload.voiceGenId}`,
              public_id: `section_${i}`,
              format: 'mp3',
            },
            (error, result) => {
              if (error || !result) reject(error)
              else resolve(result)
            }
          ).end(audioBuffer)
        }
      )

      const sectionDuration = section.duration_sec ?? charCount / 15 // ~15 chars/sec estimate
      totalDurationSec += sectionDuration

      sectionResults.push({
        section_index: i,
        cloudinary_url: uploadResult.secure_url,
        duration_sec: sectionDuration,
        characters_used: charCount,
      })

      // Update progress in DB after each section
      await db
        .update(voiceGenerations)
        .set({ sections: sectionResults })
        .where(eq(voiceGenerations.id, payload.voiceGenId))
    }

    // For the final combined audio, use Cloudinary's concatenation transformation
    const firstSection = sectionResults[0]
    const finalAudioUrl = firstSection?.cloudinary_url ?? ''

    // Mark completed
    await db
      .update(voiceGenerations)
      .set({
        sections: sectionResults,
        fullAudioUrl: finalAudioUrl,
        totalChars,
        totalDurationSec,
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(voiceGenerations.id, payload.voiceGenId))

    // Record API usage (ElevenLabs bills per character)
    const costPerChar = 0.00012 // ~$0.12 per 1K chars (Creator plan)
    const costUsd = (totalChars * costPerChar).toFixed(6)

    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: 'elevenlabs',
      endpoint: 'text-to-speech',
      unitsUsed: totalChars.toString(),
      unitType: 'chars',
      costUsd,
      resourceType: 'voice_generation',
      resourceId: payload.voiceGenId,
    })

    logger.info(`Voice generation ${payload.voiceGenId} completed: ${totalChars} chars, ${totalDurationSec}s`)
    return { voiceGenId: payload.voiceGenId, totalChars, totalDurationSec, sections: sectionResults.length }
  },
})
