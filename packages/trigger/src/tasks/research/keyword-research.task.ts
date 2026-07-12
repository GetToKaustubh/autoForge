import { task, logger } from '@trigger.dev/sdk'
import { generateJSON } from '../../lib/gemini'
import { db } from '../../lib/db'
import { keywordResearch, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

export const keywordResearchTask = task({
  id: 'keyword-research',
  maxDuration: 180,

  run: async (payload: {
    researchId: string
    seedKeyword: string
    niche?: string
    organizationId: string
    userId: string
  }) => {
    const { researchId, seedKeyword, niche, organizationId, userId } = payload

    const prompt = `Research YouTube keywords for: "${seedKeyword}"${niche ? ` in the "${niche}" niche` : ''}.

Return a JSON object:
{
  "keywords": [
    {
      "keyword": "string",
      "searchVolume": "low" | "medium" | "high" | "very_high",
      "competition": "low" | "medium" | "high",
      "cpc": number,
      "intent": "informational" | "commercial" | "navigational" | "transactional",
      "type": "short_tail" | "long_tail" | "question" | "comparison",
      "difficulty": number,
      "opportunity": number,
      "relatedKeywords": ["string"],
      "videoAngle": "string"
    }
  ],
  "clusters": [{ "theme": "string", "keywords": ["string"], "contentStrategy": "string" }],
  "topOpportunity": "string",
  "contentGaps": ["string"]
}

Return 15-20 keywords. difficulty and opportunity are 0-100.`

    const result = await generateJSON<{ keywords: unknown[] }>(
      prompt,
      'You are an expert YouTube SEO strategist. Respond with valid JSON only.',
      { temperature: 0.3 },
    )

    await db
      .update(keywordResearch)
      .set({ results: result.data, source: 'ai' })
      .where(eq(keywordResearch.id, researchId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'openai',
      unitsUsed: String(result.inputTokens + result.outputTokens), unitType: 'tokens',
      costUsd: result.costUsd.toFixed(6), resourceType: 'keyword_research', resourceId: researchId,
      metadata: { model: 'gemini-3.1-flash-lite' },
    })

    const keywords = Array.isArray(result.data?.keywords) ? result.data.keywords : []
    logger.info(`Keyword research ${researchId} completed: ${keywords.length} keywords`)
    return { researchId, keywordsFound: keywords.length }
  },
})
