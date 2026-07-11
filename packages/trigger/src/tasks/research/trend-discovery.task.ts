import { task, logger } from '@trigger.dev/sdk/v3'
import Anthropic from '@anthropic-ai/sdk'
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

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
      temperature: 0.4,
    })

    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    const costUsd = (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0

    const content = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in trend discovery response')
    const trendData = JSON.parse(jsonMatch[0])

    const expiresAt = trendData.expiresAt
      ? new Date(trendData.expiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await db
      .update(trends)
      .set({ trendData, expiresAt })
      .where(eq(trends.id, trendId))

    await db.insert(apiUsage).values({
      organizationId, userId, service: 'anthropic',
      unitsUsed: String(inputTokens + outputTokens), unitType: 'tokens',
      costUsd: costUsd.toFixed(6), resourceType: 'trend_discovery', resourceId: trendId,
    })

    logger.info(`Trend discovery ${trendId} completed: ${trendData.trends?.length ?? 0} trends`)
    return { trendId, trendsFound: trendData.trends?.length ?? 0 }
  },
})
