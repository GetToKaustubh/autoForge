import { task, logger } from '@trigger.dev/sdk'
import { generateJSON } from '../../lib/gemini'
import { db } from '../../lib/db'
import { nicheResearch, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

const SYSTEM_PROMPT = `You are an expert YouTube niche analyst with deep knowledge of content monetization, audience growth, and market saturation. Analyze niches scientifically and provide data-driven insights. Respond with valid JSON only.`

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

Return 5-8 niches. score is 0-100.`

    const result = await generateJSON<{ niches: unknown[] }>(prompt, SYSTEM_PROMPT, { temperature: 0.3 })

    await db
      .update(nicheResearch)
      .set({
        niches: result.data,
        modelUsed: 'gemini-3.1-flash-lite',
        tokensUsed: result.inputTokens + result.outputTokens,
        status: 'completed',
      })
      .where(eq(nicheResearch.id, researchId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'openai',
      unitsUsed: String(result.inputTokens + result.outputTokens), unitType: 'tokens',
      costUsd: result.costUsd.toFixed(6), resourceType: 'niche_research', resourceId: researchId,
      metadata: { model: 'gemini-3.1-flash-lite', inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    })

    const nichesArr = Array.isArray(result.data?.niches) ? result.data.niches : []
    logger.info(`Niche research ${researchId} completed: ${nichesArr.length} niches found`)
    return { researchId, nichesFound: nichesArr.length }
  },
})
