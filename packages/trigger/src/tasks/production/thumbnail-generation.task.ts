import { task, logger } from '@trigger.dev/sdk'
import { db } from '../../lib/db'
import { thumbnails, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

// Pollinations.ai — free image generation, no API key required
// Uses Flux / SDXL under the hood. 1280x720 = YouTube thumbnail ratio.
function pollinationsUrl(prompt: string, seed: number): string {
  const encoded = encodeURIComponent(prompt)
  return `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`
}

export const thumbnailGenerationTask = task({
  id: 'thumbnail-generation',
  maxDuration: 300,

  run: async (payload: {
    thumbnailId: string
    videoTitle: string
    thumbnailConcept?: string
    organizationId: string
    userId: string
    variantCount?: number
  }) => {
    const { thumbnailId, videoTitle, thumbnailConcept, organizationId, userId, variantCount = 3 } = payload

    await db
      .update(thumbnails)
      .set({ status: 'processing' })
      .where(eq(thumbnails.id, thumbnailId))

    // A short concept ("bold, energetic") is meant to season one of a few
    // differently-styled takes. A long, fully art-directed concept (specific
    // composition, lighting, on-image text, layout) is meant to BE the
    // thumbnail - appending "minimalist bold design" or "dramatic close-up"
    // to it would contradict details the user already specified. Past that
    // length, use the concept verbatim for every variant and let the only
    // difference between them be the generation seed.
    const hasDetailedConcept = !!thumbnailConcept && thumbnailConcept.trim().length > 150

    const basePrompts = hasDetailedConcept
      ? Array.from({ length: variantCount }, () => `${thumbnailConcept}. YouTube thumbnail, 16:9, 1280x720.`)
      : [
          `YouTube thumbnail, "${videoTitle}", ${thumbnailConcept ?? ''}, bold text overlay, high contrast, professional, eye-catching, 16:9`,
          `YouTube thumbnail, "${videoTitle}", ${thumbnailConcept ?? ''}, cinematic lighting, vibrant colors, dramatic close-up, 16:9`,
          `YouTube thumbnail, "${videoTitle}", ${thumbnailConcept ?? ''}, minimalist bold design, contrasting background, clear visual hierarchy, 16:9`,
        ].slice(0, variantCount)

    // Pollinations is URL-based — just generating the URLs is instant.
    // The image is fetched/rendered lazily when the URL is accessed.
    const variants = basePrompts.map((prompt, i) => ({
      url: pollinationsUrl(prompt, Date.now() + i),
      prompt,
      variant: i + 1,
    }))

    await db
      .update(thumbnails)
      .set({
        variants,
        selectedUrl: variants[0]?.url,
        generationModel: 'pollinations-flux',
        status: 'completed',
      })
      .where(eq(thumbnails.id, thumbnailId))

    // Pollinations is free — cost = $0
    await db.insert(apiUsage).values({
      organizationId, userId, service: 'openai',
      unitsUsed: String(variantCount), unitType: 'images',
      costUsd: '0.000000', resourceType: 'thumbnail', resourceId: thumbnailId,
      metadata: { model: 'pollinations-flux' },
    })

    logger.info(`Thumbnail generation ${thumbnailId} done: ${variants.length} variants (Pollinations.ai)`)
    return { thumbnailId, variants, selectedUrl: variants[0]?.url }
  },
})
