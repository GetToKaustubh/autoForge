import { task, logger } from '@trigger.dev/sdk'
import { db } from '../../lib/db'
import { thumbnails, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

const IMAGEN_MODELS = {
  'imagen-fast': { id: 'imagen-4.0-fast-generate-001', costPerImage: 0.02 },
  'imagen-standard': { id: 'imagen-4.0-generate-001', costPerImage: 0.04 },
  'imagen-ultra': { id: 'imagen-4.0-ultra-generate-001', costPerImage: 0.06 },
} as const

type ThumbnailModel = 'pollinations' | keyof typeof IMAGEN_MODELS

// Pollinations.ai — free image generation, no API key required
// Uses Flux / SDXL under the hood. 1280x720 = YouTube thumbnail ratio.
function pollinationsUrl(prompt: string, seed: number): string {
  const encoded = encodeURIComponent(prompt)
  return `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`
}

// Imagen 4 (Google GenAI SDK) — synchronous, no polling needed (unlike Veo's
// long-running video operations). Returns base64 image bytes directly since
// no outputGcsUri is set, so each variant is uploaded to Cloudinary here to
// get a stable hosted URL, same as every other provider in this app.
async function generateWithImagen(
  prompt: string,
  model: keyof typeof IMAGEN_MODELS,
  seed: number,
  cloudinary: typeof import('cloudinary').v2,
  folder: string,
  publicId: string
): Promise<string> {
  const { GoogleGenAI, PersonGeneration } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! })

  const result = await ai.models.generateImages({
    model: IMAGEN_MODELS[model].id,
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: '16:9',
      seed,
      // Imagen rejects seed when watermarking is on (its default) - seed is
      // used here purely to vary each of the 3 variants, so watermarking
      // isn't a feature being deliberately traded away.
      addWatermark: false,
      personGeneration: PersonGeneration.ALLOW_ADULT,
    },
  })

  const image = result.generatedImages?.[0]?.image
  if (!image?.imageBytes) {
    const filtered = result.generatedImages?.[0]?.raiFilteredReason
    throw new Error(filtered ? `Imagen filtered this prompt: ${filtered}` : 'Imagen returned no image')
  }

  const dataUri = `data:${image.mimeType ?? 'image/png'};base64,${image.imageBytes}`
  const uploaded = await cloudinary.uploader.upload(dataUri, {
    resource_type: 'image',
    folder,
    public_id: publicId,
    format: 'png',
  })
  return uploaded.secure_url
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
    model?: ThumbnailModel
  }) => {
    const { thumbnailId, videoTitle, thumbnailConcept, organizationId, userId, variantCount = 3, model = 'pollinations' } = payload

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

    let variants: Array<{ url: string; prompt: string; variant: number }>
    let totalCostUsd = 0

    if (model === 'pollinations') {
      // Pollinations is URL-based — just generating the URLs is instant.
      // The image is fetched/rendered lazily when the URL is accessed.
      variants = basePrompts.map((prompt, i) => ({
        url: pollinationsUrl(prompt, Date.now() + i),
        prompt,
        variant: i + 1,
      }))
    } else {
      const cloudinaryModule = await import('cloudinary')
      const cloudinary = (cloudinaryModule as unknown as { v2?: typeof cloudinaryModule.v2 }).v2
        ?? (cloudinaryModule as unknown as { default: { v2: typeof cloudinaryModule.v2 } }).default.v2
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      })

      const folder = `tubeforge/${organizationId}/thumbnails/${thumbnailId}`
      variants = []
      for (let i = 0; i < basePrompts.length; i++) {
        const prompt = basePrompts[i]!
        try {
          const url = await generateWithImagen(prompt, model, Date.now() + i, cloudinary, folder, `variant_${i + 1}`)
          variants.push({ url, prompt, variant: i + 1 })
          totalCostUsd += IMAGEN_MODELS[model].costPerImage
          logger.info(`Imagen variant ${i + 1}/${basePrompts.length} completed`)
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          logger.info(`Imagen variant ${i + 1} failed: ${error}`)
        }
      }
      if (variants.length === 0) {
        await db
          .update(thumbnails)
          .set({ status: 'failed', errorMessage: 'All Imagen variants failed to generate', generationModel: IMAGEN_MODELS[model].id })
          .where(eq(thumbnails.id, thumbnailId))
        throw new Error('All Imagen variants failed to generate')
      }
    }

    await db
      .update(thumbnails)
      .set({
        variants,
        selectedUrl: variants[0]?.url,
        generationModel: model === 'pollinations' ? 'pollinations-flux' : IMAGEN_MODELS[model].id,
        status: 'completed',
      })
      .where(eq(thumbnails.id, thumbnailId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: model === 'pollinations' ? 'openai' : 'imagen',
      unitsUsed: String(variants.length), unitType: 'images',
      costUsd: totalCostUsd.toFixed(6), resourceType: 'thumbnail', resourceId: thumbnailId,
      metadata: { model: model === 'pollinations' ? 'pollinations-flux' : IMAGEN_MODELS[model].id },
    })

    logger.info(`Thumbnail generation ${thumbnailId} done: ${variants.length} variants (${model})`)
    return { thumbnailId, variants, selectedUrl: variants[0]?.url }
  },
})
