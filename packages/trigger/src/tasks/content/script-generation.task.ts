import { task, logger } from '@trigger.dev/sdk'
import { generateJSON } from '../../lib/gemini'
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

    const systemPrompt = `You are an expert YouTube script writer. Write engaging, educational scripts optimized for viewer retention.
Your scripts must:
- Open with a powerful hook in the first 15 seconds
- Follow a clear structure: Hook → Problem → Solution → Value → CTA
- Use conversational language appropriate for YouTube
- Include natural transitions between sections
- End with a strong call-to-action

Output JSON with this exact structure (typically 5 sections: hook, intro, main, cta, outro — adjust as needed):
{
  "sections": [
    { "type": "string, e.g. hook/intro/main/cta/outro", "content": "the actual script text for this section", "duration_sec": "integer — estimate from this section's own word count at ~2.5 words/second, NOT a fixed value", "notes": "..." }
  ]
}

Critical: duration_sec for each section must be calculated from that section's actual word count (words / 2.5 ≈ seconds), never copied from an example. The sum of all duration_sec values must be within 10% of the target duration below.`

    const userPrompt = `Write a YouTube script for:
Title: ${idea.title}
Hook: ${idea.hook ?? 'Create a compelling hook'}
Target keywords: ${(idea.targetKeywords ?? []).join(', ')}
Target duration: ${Math.round(payload.targetDurationSec / 60)} minutes (${payload.targetDurationSec} seconds total — write enough content across all sections to actually fill this, and set each duration_sec from real word count)
Tone: ${payload.tone}
Format: ${idea.format ?? 'educational'}

Make the script ready to be read aloud by a voice-over artist.`

    const result = await generateJSON<{ sections: Array<{
      type: string; content: string; duration_sec: number; notes: string
    }> }>(userPrompt, systemPrompt)

    // The model is asked to self-report duration_sec per section (words/2.5),
    // but its own arithmetic routinely doesn't match its own word count -
    // confirmed live, a script's sections summed to 45s while word_count/2.5
    // for the same script gave 39s, a visible mismatch in the section
    // timeline. Recompute every section's duration from its actual content
    // instead of trusting the self-reported number.
    const sections = result.data.sections.map((s) => ({
      ...s,
      duration_sec: Math.round(s.content.trim().split(/\s+/).filter(Boolean).length / 2.5),
    }))

    const fullText = sections.map((s) => s.content).join('\n\n')
    const wordCount = fullText.split(/\s+/).length
    const estimatedDuration = Math.round(wordCount / 2.5)

    await db
      .update(scripts)
      .set({
        sections,
        fullText,
        wordCount,
        estimatedDurationSec: estimatedDuration,
        modelUsed: 'gemini-3.1-flash-lite',
        tokensUsed: result.inputTokens + result.outputTokens,
        status: 'review',
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, payload.scriptId))

    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: 'anthropic',
      endpoint: 'script-generation',
      unitsUsed: String(result.inputTokens + result.outputTokens),
      unitType: 'tokens',
      costUsd: result.costUsd.toFixed(6),
      resourceType: 'script',
      resourceId: payload.scriptId,
      metadata: { model: 'gemini-3.1-flash-lite', inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    })

    logger.info(`Script generation ${payload.scriptId} completed: ${wordCount} words`)
    return { scriptId: payload.scriptId, wordCount, sections: result.data.sections.length }
  },
})
