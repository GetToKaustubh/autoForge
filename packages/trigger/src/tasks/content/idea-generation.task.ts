import { task, logger } from '@trigger.dev/sdk'
import OpenAI from 'openai'
import { db } from '../../lib/db'
import { videoIdeas, apiUsage } from '../../lib/db/schema'

export const ideaGenerationTask = task({
  id: 'idea-generation',
  maxDuration: 120,

  run: async (payload: {
    channelId: string
    organizationId: string
    userId: string
    niche: string
    keywords?: string[]
    count?: number
    format?: 'tutorial' | 'review' | 'listicle' | 'vlog' | 'documentary' | 'shorts' | 'live' | 'comparison'
    targetAudience?: string
  }) => {
    const { channelId, organizationId, userId, niche, keywords = [], count = 10, format, targetAudience } = payload

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

    const prompt = `Generate ${count} compelling YouTube video ideas for the "${niche}" niche.
${keywords.length > 0 ? `Target keywords: ${keywords.join(', ')}` : ''}
${format ? `Preferred format: ${format}` : ''}
${targetAudience ? `Target audience: ${targetAudience}` : ''}

Return JSON:
{
  "ideas": [
    {
      "title": "string (compelling YouTube title, 60 chars max)",
      "hook": "string (first 15 seconds hook)",
      "description": "string (2-3 sentences)",
      "format": "tutorial" | "review" | "listicle" | "vlog" | "documentary" | "shorts" | "live" | "comparison",
      "targetKeywords": ["string"],
      "estimatedViewsMin": number, "estimatedViewsMax": number,
      "priority": number (1-10)
    }
  ]
}`

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a viral YouTube content strategist. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      temperature: 0.8,
    })

    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0
    const costUsd = (inputTokens / 1_000_000) * 2.5 + (outputTokens / 1_000_000) * 10.0

    const { ideas } = JSON.parse(response.choices[0]?.message?.content ?? '{}') as {
      ideas: Array<{
        title: string; hook?: string; description?: string; format?: string
        targetKeywords?: string[]; estimatedViewsMin?: number; estimatedViewsMax?: number; priority?: number
      }>
    }

    const VALID_FORMATS = ['tutorial', 'review', 'listicle', 'vlog', 'documentary', 'shorts', 'live', 'comparison'] as const
    type ValidFormat = typeof VALID_FORMATS[number]

    const inserted = await db
      .insert(videoIdeas)
      .values(ideas.map((idea) => ({
        channelId, organizationId, createdBy: userId,
        title: idea.title, hook: idea.hook, description: idea.description,
        format: VALID_FORMATS.includes(idea.format as ValidFormat) ? (idea.format as ValidFormat) : ('tutorial' as ValidFormat),
        targetKeywords: idea.targetKeywords ?? [],
        estimatedViewsMin: idea.estimatedViewsMin, estimatedViewsMax: idea.estimatedViewsMax,
        priority: Math.min(10, Math.max(1, idea.priority ?? 5)),
        status: 'idea' as const,
      })))
      .returning({ id: videoIdeas.id })

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'openai',
      unitsUsed: String(inputTokens + outputTokens), unitType: 'tokens',
      costUsd: costUsd.toFixed(6), resourceType: 'idea_generation', resourceId: channelId,
    })

    logger.info(`Idea generation for channel ${channelId}: ${inserted.length} ideas created`)
    return { ideasGenerated: inserted.length, ideaIds: inserted.map((r) => r.id) }
  },
})
