import { task, logger } from '@trigger.dev/sdk/v3'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../../lib/db'
import { nicheResearch, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

const SYSTEM_PROMPT = `You are an expert YouTube niche analyst with deep knowledge of content monetization, audience growth, and market saturation. Analyze niches scientifically and provide data-driven insights.`

export const nicheResearchTask = task({
  id: 'niche-research',
  maxDuration: 300,

  run: async (payload: {
    researchId: string
    query: string
    organizationId: string
    userId: string
  }) => {
    const { researchId, query, organizationId, userId } = payload

    await db
      .update(nicheResearch)
      .set({ status: 'running' })
      .where(eq(nicheResearch.id, researchId))

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const prompt = `Research YouTube niches related to: "${query}"

Return a JSON object with this exact structure:
{
  "niches": [
    {
      "name": "string",
      "description": "string",
      "estimatedMonthlySearchVolume": number,
      "competitionLevel": "low" | "medium" | "high",
      "monetizationPotential": "low" | "medium" | "high",
      "averageCpm": number,
      "contentFormats": ["string"],
      "keyTopics": ["string"],
      "targetAudience": "string",
      "growthTrend": "declining" | "stable" | "growing" | "exploding",
      "entryBarrier": "low" | "medium" | "high",
      "score": number
    }
  ],
  "summary": "string",
  "recommendedNiche": "string",
  "reasoning": "string"
}

Return 5-8 niches. Score is 0-100.`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      temperature: 0.3,
    })

    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    const costUsd = (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0

    const content = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in Anthropic response')
    const niches = JSON.parse(jsonMatch[0])

    await db
      .update(nicheResearch)
      .set({ niches, modelUsed: 'claude-sonnet-4-6', tokensUsed: inputTokens + outputTokens, status: 'completed' })
      .where(eq(nicheResearch.id, researchId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'anthropic',
      unitsUsed: String(inputTokens + outputTokens), unitType: 'tokens',
      costUsd: costUsd.toFixed(6), resourceType: 'niche_research', resourceId: researchId,
    })

    logger.info(`Niche research ${researchId} completed: ${niches.niches?.length ?? 0} niches found`)
    return { researchId, nichesFound: niches.niches?.length ?? 0 }
  },
})
