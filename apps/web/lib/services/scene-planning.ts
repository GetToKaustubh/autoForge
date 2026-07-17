import { z } from 'zod'
import { generateText } from './gemini'

// Mirrors the real per-scene structure the user's own Google Vids/Veo
// production used (confirmed via a full transcript of their actual
// alphabet-fruits video prompts): every scene has a spoken dialogue line,
// a detailed still-image prompt (character/reference image), and a
// separate motion/animation prompt — not one blended text-to-video prompt.
// Every scene is fixed at 8 seconds to match that reference structure.
const veoSceneSchema = z.object({
  scene_index: z.number().int().min(0),
  characterName: z.string().min(1).max(80),
  dialogueText: z.string().min(1).max(500),
  imagePrompt: z.string().min(10).max(600),
  animationPrompt: z.string().min(10).max(600),
  duration_sec: z.literal(8),
})

const veoSceneOutputSchema = z.object({
  scenes: z.array(veoSceneSchema).min(1).max(10),
})

export type VeoScene = z.infer<typeof veoSceneSchema>

// Capped at 10 (vs. the 30-scene ceiling for non-Veo providers) to keep an
// autopilot run's Veo generation time (image + animate per scene, each a
// long-running operation) well inside Trigger.dev's 1-hour task limit.
const MAX_VEO_SCENES = 10

export async function planVeoScenes(params: {
  scriptFullText: string
  nichePrompt: string
}): Promise<VeoScene[]> {
  const systemPrompt = `You are a video director planning scene-by-scene prompts for an AI video generator (Veo). Respond with valid JSON only.`

  const userPrompt = `Break this script into up to ${MAX_VEO_SCENES} scenes for AI video generation, matching this exact structure per scene:

- A single character or subject speaks/acts in each scene (name them).
- dialogueText: the exact line this character speaks in this scene (what a voiceover would read aloud).
- imagePrompt: a detailed prompt to generate a still reference image of this scene's character/subject in this moment — specific art style, character design, pose, expression, background, lighting.
- animationPrompt: a detailed prompt describing how that still image should be animated into 8 seconds of motion — camera movement, character motion, physics, timing.
- Every scene is exactly 8 seconds.

Channel niche/style: "${params.nichePrompt}"

Script:
"""
${params.scriptFullText.slice(0, 6000)}
"""

Return JSON:
{
  "scenes": [
    {
      "scene_index": 0,
      "characterName": "string",
      "dialogueText": "string, the spoken line for this scene",
      "imagePrompt": "string, detailed still-image generation prompt",
      "animationPrompt": "string, detailed motion/animation instruction",
      "duration_sec": 8
    }
  ]
}

Rules:
- scene_index starts at 0 and increases sequentially, one per scene
- order scenes to match the script's narrative flow
- keep dialogueText concrete and speakable in ~8 seconds (roughly 15-20 words)
- imagePrompt and animationPrompt must be visually concrete and specific, never vague or abstract`

  const result = await generateText(userPrompt, systemPrompt, {
    temperature: 0.6,
    maxOutputTokens: 4096,
    responseFormat: 'json',
  })

  const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const data = JSON.parse(cleaned)
  const validated = veoSceneOutputSchema.parse(data)
  return validated.scenes
}

// Non-Veo autopilot providers (stock/ai-image/runway/pika) — same single-prompt-
// per-scene breakdown as the manual scenes-from-script route, extracted here so
// the autopilot orchestrator can call it in-process instead of over HTTP.
const stockSceneSchema = z.object({
  scene_index: z.number().int().min(0),
  prompt: z.string().min(3).max(150),
  duration_sec: z.number().min(3).max(30),
})

const stockSceneOutputSchema = z.object({
  scenes: z.array(stockSceneSchema).min(1).max(30),
})

export type StockScene = z.infer<typeof stockSceneSchema>

export async function planStockScenes(params: {
  scriptFullText: string
  totalDurationSec: number
}): Promise<StockScene[]> {
  const totalDuration = params.totalDurationSec
  const maxScenes = Math.min(30, Math.max(3, Math.round(totalDuration / 8)))

  const prompt = `Break this YouTube video script into ${maxScenes} or fewer visual scenes for B-roll/stock footage sourcing.

Script (${totalDuration}s total):
"""
${params.scriptFullText.slice(0, 6000)}
"""

Return JSON:
{
  "scenes": [
    { "scene_index": 0, "prompt": "short visual search query, 3-8 words, concrete and stock-footage-friendly (e.g. 'man meditating mountain sunrise')", "duration_sec": number }
  ]
}

Rules:
- scene_index starts at 0 and increases sequentially
- duration_sec per scene must be between 3 and 30
- the sum of all duration_sec must be close to ${totalDuration} (within 10%)
- order scenes to match the script's narrative flow
- prompts must describe concrete, searchable visuals (objects, settings, actions) — not abstract concepts`

  const result = await generateText(prompt, 'You are a video editor planning B-roll for a YouTube script. Respond with valid JSON only.', {
    temperature: 0.4,
    maxOutputTokens: 2048,
    responseFormat: 'json',
  })

  const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const data = JSON.parse(cleaned)
  const validated = stockSceneOutputSchema.parse(data)
  return validated.scenes
}
