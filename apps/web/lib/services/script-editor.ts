import { z } from 'zod'
import { db } from '@/lib/db'
import { scriptVersions } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { generateText } from '@/lib/services/gemini'

export const scriptEditSectionSchema = z.object({
  type: z.string().min(1),
  content: z.string(),
  duration_sec: z.number().optional(),
  notes: z.string().optional(),
})

export const scriptEditResponseSchema = z.object({
  sections: z.array(scriptEditSectionSchema).min(1),
})

export type ScriptEditSection = z.infer<typeof scriptEditSectionSchema>

export function wordsAndDuration(sections: ScriptEditSection[]) {
  const fullText = sections.map((s) => s.content).join('\n\n')
  const wordCount = fullText.split(/\s+/).filter(Boolean).length
  const estimatedDurationSec = Math.round(wordCount / 2.5)
  return { fullText, wordCount, estimatedDurationSec }
}

interface ScriptRowForSync {
  id: string
  sections: unknown
  fullText: string | null
  wordCount: number | null
  estimatedDurationSec: number | null
}

// Every existing content-mutation path (manual per-section Save, full AI
// Regenerate, and now AI-editor Accept/Undo/Redo/Restore) can change
// scripts.fullText without going through this module. Rather than hook into
// all of them, lazily detect drift here: if the row flagged "current" no
// longer matches what's actually live, snapshot the live content as a fresh
// anchor (parentVersionId null, since we can't know true lineage across an
// external mutation) and carry on. Nothing is ever deleted.
export async function ensureCurrentVersion(
  script: ScriptRowForSync,
  organizationId: string,
  userDbId: string
) {
  const [current] = await db
    .select()
    .from(scriptVersions)
    .where(and(eq(scriptVersions.scriptId, script.id), eq(scriptVersions.isCurrent, true)))
    .limit(1)

  if (current && (current.fullText ?? '') === (script.fullText ?? '')) {
    return current
  }

  const maxRows = await db
    .select({ max: sql<number>`coalesce(max(${scriptVersions.versionNumber}), 0)` })
    .from(scriptVersions)
    .where(eq(scriptVersions.scriptId, script.id))
  const max = maxRows[0]?.max ?? 0

  if (current) {
    await db.update(scriptVersions).set({ isCurrent: false }).where(eq(scriptVersions.id, current.id))
  }

  const [snapshot] = await db
    .insert(scriptVersions)
    .values({
      scriptId: script.id,
      organizationId,
      versionNumber: Number(max) + 1,
      parentVersionId: null,
      sections: script.sections,
      fullText: script.fullText,
      wordCount: script.wordCount,
      estimatedDurationSec: script.estimatedDurationSec,
      instruction: null,
      isCurrent: true,
      createdBy: userDbId,
    })
    .returning()

  if (!snapshot) throw new Error('Failed to snapshot current script version')
  return snapshot
}

const SYSTEM_INSTRUCTION = `You are an expert YouTube script writer and conversational script editor.

Your task is to modify the latest provided YouTube script according to the user's newest editing instruction.

Use the conversation history only to understand context, references, previously requested modifications, and follow-up instructions.

Always treat the latest accepted script as the current source of truth.

Apply only the changes requested by the user. Preserve all content that the user did not request to modify. Do not unnecessarily rewrite unrelated sections.

Maintain logical flow, factual consistency, readability, pacing, language, and tone.

If the user refers to "that section," "the previous part," "it," "the intro," "the ending," or a previous modification, use the conversation context to identify what they mean.

Preserve previously accepted modifications unless the user specifically asks to remove, reverse, or change them.

Return the complete updated script as JSON: { "sections": [{ "type": "hook|intro|main|cta|outro or similar", "content": "full section text", "duration_sec": integer estimated from word count at ~2.5 words/second, "notes": "optional director notes" }] }. Return every section, not only the ones you changed. Do not return explanations, markdown formatting, code fences, editing notes, headings such as "Updated Script," or any commentary outside the JSON.`

export async function callGeminiScriptEdit(params: {
  currentSections: ScriptEditSection[]
  recentInstructions: string[]
  instruction: string
}) {
  const { currentSections, recentInstructions, instruction } = params

  const historyBlock = recentInstructions.length
    ? `Recent accepted editing instructions in this session, oldest first (for context only — the script below already reflects all of them):\n${recentInstructions.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : 'No prior editing instructions in this session yet.'

  const prompt = `${historyBlock}

Current script (JSON sections, source of truth):
${JSON.stringify({ sections: currentSections })}

New editing instruction: "${instruction}"

Return the complete updated script as JSON per the required format.`

  const result = await generateText(prompt, SYSTEM_INSTRUCTION, {
    temperature: 0.6,
    maxOutputTokens: 8192,
    responseFormat: 'json',
  })

  let parsed: unknown
  try {
    const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI returned an invalid response. Please retry.')
  }

  const validated = scriptEditResponseSchema.safeParse(parsed)
  if (!validated.success) {
    throw new Error('AI returned an incomplete or malformed script. Please retry.')
  }

  // Same fix as script generation: the model's self-reported duration_sec
  // per section doesn't reliably match its own word count, producing section
  // timeline badges that don't add up. Recompute from actual content instead.
  const sections = validated.data.sections.map((s) => ({
    ...s,
    duration_sec: Math.round(s.content.trim().split(/\s+/).filter(Boolean).length / 2.5),
  }))

  return {
    sections,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  }
}
