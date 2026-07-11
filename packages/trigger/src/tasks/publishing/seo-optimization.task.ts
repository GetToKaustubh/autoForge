import { task, logger } from '@trigger.dev/sdk'
import { generateJSON } from '../../lib/gemini'
import { db } from '../../lib/db'
import { videos, seoOptimizations, scripts, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

export const seoOptimizationTask = task({
  id: 'seo-optimization',
  maxDuration: 120,
  retry: { maxAttempts: 3 },

  run: async (payload: {
    videoId: string
    seoId: string
    organizationId: string
    currentTitle: string
    currentDescription?: string
    currentTags?: string[]
    targetKeywords?: string[]
    channelNiche?: string
  }) => {
    logger.info(`Starting SEO optimization for video ${payload.videoId}`)

    const [video] = await db
      .select({ scriptId: videos.scriptId, title: videos.title })
      .from(videos)
      .where(eq(videos.id, payload.videoId))
      .limit(1)

    let scriptSummary = ''
    if (video?.scriptId) {
      const [script] = await db
        .select({ fullText: scripts.fullText })
        .from(scripts)
        .where(eq(scripts.id, video.scriptId))
        .limit(1)
      if (script?.fullText) scriptSummary = script.fullText.slice(0, 2000)
    }

    const systemPrompt = `You are a YouTube SEO expert. Return optimized metadata as valid JSON only.
Return ONLY a JSON object:
{
  "optimizedTitle": "string (max 100 chars, primary keyword near start)",
  "optimizedDescription": "string (max 5000 chars, keyword-rich first 150 chars)",
  "tags": ["30-40 relevant tags, mix broad and specific"],
  "hashtags": ["#relevant", "#hashtags", "max 15"],
  "chapters": [{"timestamp_sec": 0, "title": "Intro"}],
  "titleScore": 0.0,
  "descriptionScore": 0.0,
  "tagScore": 0.0,
  "overallScore": 0.0,
  "improvements": ["key changes made"]
}`

    const userPrompt = `Optimize YouTube SEO for:
Title: ${payload.currentTitle}
Description: ${payload.currentDescription ?? 'None provided'}
Tags: ${(payload.currentTags ?? []).join(', ') || 'None provided'}
Target Keywords: ${(payload.targetKeywords ?? []).join(', ') || 'None provided'}
Channel Niche: ${payload.channelNiche ?? 'General'}
Script excerpt: ${scriptSummary || 'Not available'}`

    const result = await generateJSON<{
      optimizedTitle: string
      optimizedDescription: string
      tags: string[]
      hashtags: string[]
      chapters: Array<{ timestamp_sec: number; title: string }>
      titleScore: number
      descriptionScore: number
      tagScore: number
      overallScore: number
    }>(userPrompt, systemPrompt, { maxOutputTokens: 2048 })

    const seoData = result.data

    await db
      .update(seoOptimizations)
      .set({
        optimizedTitle: seoData.optimizedTitle,
        optimizedDescription: seoData.optimizedDescription,
        tags: seoData.tags,
        hashtags: seoData.hashtags,
        chapters: seoData.chapters,
        titleScore: seoData.titleScore,
        descriptionScore: seoData.descriptionScore,
        tagScore: seoData.tagScore,
        overallScore: seoData.overallScore,
        modelUsed: 'gemini-2.0-flash',
        updatedAt: new Date(),
      })
      .where(eq(seoOptimizations.id, payload.seoId))

    await db
      .update(videos)
      .set({
        pipelineStage: 'seo_optimized',
        ytTitle: seoData.optimizedTitle,
        ytDescription: seoData.optimizedDescription,
        ytTags: seoData.tags,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, payload.videoId))

    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: 'anthropic',
      endpoint: 'seo-optimization',
      unitsUsed: String(result.inputTokens + result.outputTokens),
      unitType: 'tokens',
      costUsd: result.costUsd.toFixed(6),
      resourceType: 'video',
      resourceId: payload.videoId,
      metadata: { model: 'gemini-2.0-flash' },
    })

    logger.info(`SEO optimization ${payload.seoId} complete: overall score ${seoData.overallScore}`)
    return { seoId: payload.seoId, overallScore: seoData.overallScore }
  },
})
