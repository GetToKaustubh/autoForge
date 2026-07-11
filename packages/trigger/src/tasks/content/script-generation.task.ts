import { task, logger } from '@trigger.dev/sdk/v3'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const scriptPayloadSchema = z.object({
  scriptId: z.string().uuid(),
  ideaId: z.string().uuid(),
  organizationId: z.string().uuid(),
  targetDurationSec: z.number().default(600),
  tone: z.string().default('engaging and educational'),
  model: z.enum(['claude-sonnet-4-6', 'gpt-4o']).default('claude-sonnet-4-6'),
})

export type ScriptGenerationPayload = z.infer<typeof scriptPayloadSchema>

export const scriptGenerationTask = task({
  id: 'script-generation',
  maxDuration: 180,
  retry: { maxAttempts: 2, minTimeoutInMs: 3000 },

  run: async (rawPayload: ScriptGenerationPayload) => {
    const payload = scriptPayloadSchema.parse(rawPayload)
    logger.info(`Starting script generation for ${payload.scriptId}`)

    // Dynamic import to avoid bundling DB in every task
    const { db } = await import('../../lib/db')
    const { scripts, videoIdeas, apiUsage } = await import('../../lib/db/schema')
    const { eq } = await import('drizzle-orm')

    // Fetch idea details
    const [idea] = await db
      .select()
      .from(videoIdeas)
      .where(eq(videoIdeas.id, payload.ideaId))
      .limit(1)

    if (!idea) throw new Error(`Idea ${payload.ideaId} not found`)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const systemPrompt = `You are an expert YouTube script writer. Write engaging, educational scripts optimized for viewer retention.
Your scripts must:
- Open with a powerful hook in the first 15 seconds
- Follow a clear structure: Hook → Problem → Solution → Value → CTA
- Use conversational language appropriate for YouTube
- Include natural transitions between sections
- End with a strong call-to-action

Output JSON with this exact structure:
{
  "sections": [
    { "type": "hook", "content": "...", "duration_sec": 15, "notes": "..." },
    { "type": "intro", "content": "...", "duration_sec": 30, "notes": "..." },
    { "type": "main", "content": "...", "duration_sec": 480, "notes": "..." },
    { "type": "cta", "content": "...", "duration_sec": 45, "notes": "..." },
    { "type": "outro", "content": "...", "duration_sec": 30, "notes": "..." }
  ]
}`

    const userPrompt = `Write a YouTube script for:
Title: ${idea.title}
Hook: ${idea.hook ?? 'Create a compelling hook'}
Target keywords: ${(idea.targetKeywords ?? []).join(', ')}
Target duration: ${Math.round(payload.targetDurationSec / 60)} minutes
Tone: ${payload.tone}
Format: ${idea.format ?? 'educational'}

Make the script ready to be read aloud by a voice-over artist.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const content = response.content[0]
    if (content?.type !== 'text') throw new Error('Unexpected response format from Anthropic')

    const parsed = JSON.parse(content.text) as { sections: Array<{
      type: string; content: string; duration_sec: number; notes: string
    }> }

    const fullText = parsed.sections.map((s) => s.content).join('\n\n')
    const wordCount = fullText.split(/\s+/).length
    const estimatedDuration = Math.round(wordCount / 2.5) // ~150 words/min

    const tokensIn = response.usage.input_tokens
    const tokensOut = response.usage.output_tokens
    const costUsd = (tokensIn * 0.000003 + tokensOut * 0.000015).toFixed(6)

    // Update script record
    await db
      .update(scripts)
      .set({
        sections: parsed.sections,
        fullText,
        wordCount,
        estimatedDurationSec: estimatedDuration,
        modelUsed: 'claude-sonnet-4-6',
        tokensUsed: tokensIn + tokensOut,
        status: 'review',
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, payload.scriptId))

    // Record API usage
    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: 'anthropic',
      endpoint: 'messages.create',
      unitsUsed: (tokensIn + tokensOut).toString(),
      unitType: 'tokens',
      costUsd,
      resourceType: 'script',
      resourceId: payload.scriptId,
      metadata: { model: 'claude-sonnet-4-6', inputTokens: tokensIn, outputTokens: tokensOut },
    })

    logger.info(`Script generation ${payload.scriptId} completed: ${wordCount} words`)
    return { scriptId: payload.scriptId, wordCount, sections: parsed.sections.length }
  },
})
