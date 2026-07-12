import { task, logger } from '@trigger.dev/sdk'
import { generateJSON } from '../../lib/gemini'
import { db } from '../../lib/db'
import { trends, apiUsage } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'

export const trendDiscoveryTask = task({
  id: 'trend-discovery',
  maxDuration: 180,

  run: async (payload: {
    trendId: string
    topic: string
    niche?: string
    organizationId: string
    userId: string
  }) => {
    const { trendId, topic, niche, organizationId, userId } = payload

    const prompt = `Discover current YouTube trends for topic: "${topic}"${niche ? ` in the "${niche}" niche` : ''}.

Return JSON:
{
  "trends": [
    {
      "title": "string", "description": "string",
      "momentum": "rising" | "peaked" | "evergreen",
      "velocity": number, "estimatedWeeksUntilPeak": number | null,
      "contentAngles": ["string"], "hashtags": ["string"],
      "targetDemographic": "string", "urgencyScore": number,
      "opportunityWindow": "days" | "weeks" | "months" | "evergreen"
    }
  ],
  "insights": "string", "immediateActions": ["string"],
  "expiresAt": "ISO8601 date string"
}`

    const result = await generateJSON<{ trends: unknown[]; expiresAt?: string }>(
      prompt,
      'You are a YouTube trend analyst. Respond with valid JSON only.',
      { temperature: 0.4, maxOutputTokens: 3000 },
    )

    const expiresAt = result.data.expiresAt
      ? new Date(result.data.expiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await db
      .update(trends)
      .set({ trendData: result.data, expiresAt })
      .where(eq(trends.id, trendId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'anthropic',
      unitsUsed: String(result.inputTokens + result.outputTokens), unitType: 'tokens',
      costUsd: result.costUsd.toFixed(6), resourceType: 'trend_discovery', resourceId: trendId,
      metadata: { model: 'gemini-2.5-flash' },
    })

    const trendsArr = Array.isArray(result.data?.trends) ? result.data.trends : []
    logger.info(`Trend discovery ${trendId} completed: ${trendsArr.length} trends`)
    return { trendId, trendsFound: trendsArr.length }
  },
})
