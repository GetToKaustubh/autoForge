import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { generateText } from '@/lib/services/gemini'

const bodySchema = z.object({
  scriptId: z.string().uuid(),
})

const sceneOutputSchema = z.object({
  scenes: z.array(z.object({
    scene_index: z.number().int().min(0),
    prompt: z.string().min(3).max(150),
    duration_sec: z.number().min(3).max(30),
  })).min(1).max(30),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:scenes-from-script`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [script] = await db
    .select({
      sections: scripts.sections,
      fullText: scripts.fullText,
      estimatedDurationSec: scripts.estimatedDurationSec,
      organizationId: scripts.organizationId,
    })
    .from(scripts)
    .where(and(eq(scripts.id, parsed.data.scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)

  if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 })
  if (!script.fullText) return NextResponse.json({ error: 'Script has no generated text yet' }, { status: 400 })

  const totalDuration = script.estimatedDurationSec ?? 180
  // Cap scene count at 30 (video-generation task limit) - each scene averages
  // at least ~8s so a 10 min script doesn't need 120 scenes it can't have.
  const maxScenes = Math.min(30, Math.max(3, Math.round(totalDuration / 8)))

  const prompt = `Break this YouTube video script into ${maxScenes} or fewer visual scenes for B-roll/stock footage sourcing.

Script (${totalDuration}s total):
"""
${script.fullText.slice(0, 6000)}
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
  let data: unknown
  try {
    data = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'Model returned invalid JSON' }, { status: 502 })
  }

  const validated = sceneOutputSchema.safeParse(data)
  if (!validated.success) {
    return NextResponse.json({ error: 'Model output failed validation', details: validated.error.flatten() }, { status: 502 })
  }

  return NextResponse.json({ scenes: validated.data.scenes })
}
