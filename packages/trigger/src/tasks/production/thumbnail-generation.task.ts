import { task, logger } from '@trigger.dev/sdk'
import OpenAI from 'openai'
import { v2 as cloudinary } from 'cloudinary'
import { db } from '../../lib/db'
import { thumbnails, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

function setupCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
    api_key: process.env.CLOUDINARY_API_KEY!,
    api_secret: process.env.CLOUDINARY_API_SECRET!,
    secure: true,
  })
}

async function uploadImageUrl(imageUrl: string, folder: string, publicId: string): Promise<string> {
  const result = await cloudinary.uploader.upload(imageUrl, {
    folder, public_id: publicId, resource_type: 'image',
    transformation: [{ width: 1280, height: 720, crop: 'fill' }],
  })
  return result.secure_url
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

    setupCloudinary()

    await db
      .update(thumbnails)
      .set({ status: 'processing' })
      .where(eq(thumbnails.id, thumbnailId))

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

    const prompts = [
      `YouTube thumbnail for: "${videoTitle}". ${thumbnailConcept ?? ''}. Bold text overlay, high contrast colors, shocked/excited expression, professional quality, eye-catching. 16:9 ratio.`,
      `Eye-catching YouTube thumbnail: "${videoTitle}". ${thumbnailConcept ?? ''}. Cinematic lighting, vibrant colors, dramatic close-up composition. 16:9.`,
      `Viral YouTube thumbnail: "${videoTitle}". ${thumbnailConcept ?? ''}. Minimalist but bold, contrasting background, clear visual hierarchy. 16:9.`,
    ].slice(0, variantCount)

    let totalCost = 0
    const generatedVariants: Array<{ url: string; prompt: string; index: number }> = []

    for (let i = 0; i < prompts.length; i++) {
      const response = await client.images.generate({
        model: 'dall-e-3',
        prompt: prompts[i]!,
        size: '1792x1024',
        quality: 'hd',
        style: 'vivid',
        n: 1,
      })

      const imageData = (response.data as Array<{ url?: string }>)[0]
      if (!imageData?.url) throw new Error(`DALL-E failed to generate thumbnail variant ${i + 1}`)

      const cloudinaryUrl = await uploadImageUrl(
        imageData.url,
        'tubeforge/thumbnails',
        `thumbnail_${thumbnailId}_v${i + 1}`
      )

      generatedVariants.push({ url: cloudinaryUrl, prompt: prompts[i]!, index: i + 1 })
      totalCost += 0.08
      logger.info(`Thumbnail ${thumbnailId} variant ${i + 1} generated`)
    }

    const variants = generatedVariants.map((v) => ({ url: v.url, prompt: v.prompt, variant: v.index }))

    await db
      .update(thumbnails)
      .set({ variants, selectedUrl: variants[0]?.url, generationModel: 'dall-e-3', status: 'completed' })
      .where(eq(thumbnails.id, thumbnailId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'openai',
      unitsUsed: String(variantCount), unitType: 'images',
      costUsd: totalCost.toFixed(6), resourceType: 'thumbnail', resourceId: thumbnailId,
    })

    logger.info(`Thumbnail generation ${thumbnailId} done: ${variants.length} variants`)
    return { thumbnailId, variants, selectedUrl: variants[0]?.url }
  },
})
