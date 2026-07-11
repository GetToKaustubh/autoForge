import { task, logger } from '@trigger.dev/sdk'
import OpenAI from 'openai'
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

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

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

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert YouTube SEO strategist. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      temperature: 0.3,
    })

    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0
    const costUsd = (inputTokens / 1_000_000) * 2.5 + (outputTokens / 1_000_000) * 10.0
    const results = JSON.parse(response.choices[0]?.message?.content ?? '{}')

    await db
      .update(keywordResearch)
      .set({ results, source: 'ai' })
      .where(eq(keywordResearch.id, researchId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'openai',
      unitsUsed: String(inputTokens + outputTokens), unitType: 'tokens',
      costUsd: costUsd.toFixed(6), resourceType: 'keyword_research', resourceId: researchId,
    })

    logger.info(`Keyword research ${researchId} completed: ${results.keywords?.length ?? 0} keywords`)
    return { researchId, keywordsFound: results.keywords?.length ?? 0 }
  },
})
