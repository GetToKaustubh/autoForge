import { task, logger } from '@trigger.dev/sdk'
import { db } from '../../lib/db'
import { thumbnails, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

// Standalone Imagen 4 ("predict" API) is dead for this account - confirmed
// live, every imagen-4.0-*-generate-001 model 404s with "no longer available
// to new users." Google's own error points at the replacement: image
// generation now lives inside Gemini itself via generateContent (these are
// the models Google calls "Nano Banana" in some docs), returning inline
// base64 image bytes as a response part instead of the old predict/bytes
// shape. Pricing confirmed live via ai.google.dev/gemini-api/docs/pricing.
const IMAGE_MODELS = {
  'imagen-fast': { id: 'gemini-3.1-flash-lite-image', costPerImage: 0.0336 },
  'imagen-standard': { id: 'gemini-2.5-flash-image', costPerImage: 0.039 },
  'imagen-ultra': { id: 'gemini-3-pro-image', costPerImage: 0.134 },
} as const

type ThumbnailModel = 'pollinations' | keyof typeof IMAGE_MODELS

// Pollinations.ai — free image generation, no API key required
// Uses Flux / SDXL under the hood. 1280x720 = YouTube thumbnail ratio.
function pollinationsUrl(prompt: string, seed: number): string {
  const encoded = encodeURIComponent(prompt)
  return `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`
}

// Gemini native image generation (Google GenAI SDK) — synchronous like
// Pollinations, no polling (unlike Veo's long-running video operations).
// Image comes back as an inline base64 part of a normal generateContent
// response, not a dedicated images array — uploaded to Cloudinary here to
// get a stable hosted URL, same as every other provider in this app.
async function generateWithGeminiImage(
  prompt: string,
  model: keyof typeof IMAGE_MODELS,
  cloudinary: typeof import('cloudinary').v2,
  folder: string,
  publicId: string
): Promise<string> {
  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! })

  const result = await ai.models.generateContent({
    model: IMAGE_MODELS[model].id,
    contents: `${prompt}. 16:9 widescreen aspect ratio, YouTube thumbnail composition.`,
  })

  const parts = result.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => !!p.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    const textPart = parts.find((p) => p.text)?.text
    throw new Error(textPart ? `Model returned no image: ${textPart.slice(0, 200)}` : 'Model returned no image')
  }

  const dataUri = `data:${imagePart.inlineData.mimeType ?? 'image/png'};base64,${imagePart.inlineData.data}`
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
    // difference between them be natural model variation across calls.
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
          const url = await generateWithGeminiImage(prompt, model, cloudinary, folder, `variant_${i + 1}`)
          variants.push({ url, prompt, variant: i + 1 })
          totalCostUsd += IMAGE_MODELS[model].costPerImage
          logger.info(`Image variant ${i + 1}/${basePrompts.length} completed`)
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          logger.info(`Image variant ${i + 1} failed: ${error}`)
        }
      }
      if (variants.length === 0) {
        await db
          .update(thumbnails)
          .set({ status: 'failed', errorMessage: 'All variants failed to generate', generationModel: IMAGE_MODELS[model].id })
          .where(eq(thumbnails.id, thumbnailId))
        throw new Error('All variants failed to generate')
      }
    }

    await db
      .update(thumbnails)
      .set({
        variants,
        selectedUrl: variants[0]?.url,
        generationModel: model === 'pollinations' ? 'pollinations-flux' : IMAGE_MODELS[model].id,
        status: 'completed',
      })
      .where(eq(thumbnails.id, thumbnailId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: model === 'pollinations' ? 'openai' : 'imagen',
      unitsUsed: String(variants.length), unitType: 'images',
      costUsd: totalCostUsd.toFixed(6), resourceType: 'thumbnail', resourceId: thumbnailId,
      metadata: { model: model === 'pollinations' ? 'pollinations-flux' : IMAGE_MODELS[model].id },
    })

    logger.info(`Thumbnail generation ${thumbnailId} done: ${variants.length} variants (${model})`)
    return { thumbnailId, variants, selectedUrl: variants[0]?.url }
  },
})
