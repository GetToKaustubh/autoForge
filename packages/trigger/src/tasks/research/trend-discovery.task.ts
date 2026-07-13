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
  "insights": "string", "immediateActions": ["string"]
}`

    const result = await generateJSON<{
      trends: Array<{ opportunityWindow?: 'days' | 'weeks' | 'months' | 'evergreen' }>
    }>(
      prompt,
      'You are a YouTube trend analyst. Respond with valid JSON only.',
      { temperature: 0.4, maxOutputTokens: 3000 },
    )

    // Compute the expiry ourselves from the real current time - the model
    // has no reliable notion of "today" and asking it for a raw date string
    // produced dates that were simply wrong (same failure mode as literal
    // duration_sec values earlier: it echoes a plausible-looking value
    // instead of a computed one). Use the most urgent trend's window.
    const trendsArr = Array.isArray(result.data?.trends) ? result.data.trends : []
    const windowDays: Record<string, number> = { days: 3, weeks: 14, months: 45, evergreen: 90 }
    const soonestDays = trendsArr.reduce((min, t) => {
      const d = windowDays[t.opportunityWindow ?? 'weeks'] ?? 7
      return Math.min(min, d)
    }, 7)
    const expiresAt = new Date(Date.now() + soonestDays * 24 * 60 * 60 * 1000)

    await db
      .update(trends)
      .set({ trendData: result.data, expiresAt })
      .where(eq(trends.id, trendId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'anthropic',
      unitsUsed: String(result.inputTokens + result.outputTokens), unitType: 'tokens',
      costUsd: result.costUsd.toFixed(6), resourceType: 'trend_discovery', resourceId: trendId,
      metadata: { model: 'gemini-3.1-flash-lite' },
    })

    logger.info(`Trend discovery ${trendId} completed: ${trendsArr.length} trends`)
    return { trendId, trendsFound: trendsArr.length }
  },
})
