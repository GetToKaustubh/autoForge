import { task, logger } from '@trigger.dev/sdk'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../../lib/db'
import { videos, seoOptimizations, scripts, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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

    // Fetch script for additional context
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
      if (script?.fullText) {
        scriptSummary = script.fullText.slice(0, 2000) // First 2K chars for context
      }
    }

    const systemPrompt = `You are a YouTube SEO expert. Analyze the video content and return optimized metadata as valid JSON.
Return ONLY a JSON object with these exact fields:
{
  "optimizedTitle": "string (max 100 chars, includes primary keyword near start)",
  "optimizedDescription": "string (max 5000 chars, keyword-rich first 150 chars, includes timestamps if chapters provided)",
  "tags": ["array", "of", "30-40", "relevant", "tags", "mix of broad and specific"],
  "hashtags": ["#relevant", "#hashtags", "max 15"],
  "chapters": [{"timestamp_sec": 0, "title": "Intro"}, ...],
  "titleScore": 0.0-1.0,
  "descriptionScore": 0.0-1.0,
  "tagScore": 0.0-1.0,
  "overallScore": 0.0-1.0,
  "improvements": ["brief explanation of key changes made"]
}`

    const userPrompt = `Optimize YouTube SEO for:
Title: ${payload.currentTitle}
Description: ${payload.currentDescription ?? 'None provided'}
Tags: ${(payload.currentTags ?? []).join(', ') || 'None provided'}
Target Keywords: ${(payload.targetKeywords ?? []).join(', ') || 'None provided'}
Channel Niche: ${payload.channelNiche ?? 'General'}
Script excerpt: ${scriptSummary || 'Not available'}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    })

    const rawText = message.content[0]?.type === 'text' ? message.content[0].text : ''

    let seoData: {
      optimizedTitle: string
      optimizedDescription: string
      tags: string[]
      hashtags: string[]
      chapters: Array<{ timestamp_sec: number; title: string }>
      titleScore: number
      descriptionScore: number
      tagScore: number
      overallScore: number
    }

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      seoData = JSON.parse(jsonMatch?.[0] ?? rawText)
    } catch {
      throw new Error(`Failed to parse Claude SEO response: ${rawText.slice(0, 200)}`)
    }

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
        modelUsed: 'claude-sonnet-4-6',
        updatedAt: new Date(),
      })
      .where(eq(seoOptimizations.id, payload.seoId))

    // Update video pipeline stage
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

    // Track API cost (~$0.003 per 1K input tokens, $0.015 per 1K output)
    const inputTokens = message.usage.input_tokens
    const outputTokens = message.usage.output_tokens
    const costUsd = (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015

    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: 'anthropic',
      endpoint: 'seo-optimization',
      unitsUsed: String(inputTokens + outputTokens),
      unitType: 'tokens',
      costUsd: costUsd.toFixed(6),
      resourceType: 'video',
      resourceId: payload.videoId,
    })

    logger.info(`SEO optimization ${payload.seoId} complete: overall score ${seoData.overallScore}`)
    return { seoId: payload.seoId, overallScore: seoData.overallScore }
  },
})
