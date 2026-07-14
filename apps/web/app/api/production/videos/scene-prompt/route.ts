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
  startTimeSeconds: z.number().min(0),
  endTimeSeconds: z.number().min(0),
}).refine((d) => d.endTimeSeconds > d.startTimeSeconds, { message: 'endTimeSeconds must be after startTimeSeconds' })

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:scene-prompt`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [script] = await db
    .select({ fullText: scripts.fullText, estimatedDurationSec: scripts.estimatedDurationSec })
    .from(scripts)
    .where(and(eq(scripts.id, parsed.data.scriptId), eq(scripts.organizationId, member.orgDbId)))
    .limit(1)

  if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 })
  if (!script.fullText) return NextResponse.json({ error: 'Script has no generated text yet' }, { status: 400 })

  // No word-level timestamps exist - approximate the narration segment for
  // this scene's time range proportionally against the script's total
  // estimated duration, same assumption the rest of the pipeline already
  // makes for word-count-based duration estimates.
  const totalDuration = script.estimatedDurationSec ?? 180
  const words = script.fullText.split(/\s+/).filter(Boolean)
  const startFrac = Math.max(0, Math.min(1, parsed.data.startTimeSeconds / totalDuration))
  const endFrac = Math.max(startFrac, Math.min(1, parsed.data.endTimeSeconds / totalDuration))
  const startWord = Math.floor(startFrac * words.length)
  const endWord = Math.max(startWord + 1, Math.ceil(endFrac * words.length))
  const segment = words.slice(startWord, endWord).join(' ') || script.fullText.slice(0, 500)

  const prompt = `This is one segment of a YouTube video's narration, covering roughly ${Math.round(parsed.data.startTimeSeconds)}s-${Math.round(parsed.data.endTimeSeconds)}s of the video:

"""
${segment}
"""

Write ONE visual description (1-2 sentences, cinematic and concrete) for what should appear on screen during this segment. Describe objects, setting, action, camera framing - not abstract concepts. Return only the description, no JSON, no quotes, no preamble.`

  const result = await generateText(prompt, 'You are a video editor describing B-roll visuals for a narration segment.', {
    temperature: 0.6,
    maxOutputTokens: 200,
  })

  const visualPrompt = result.content.trim().replace(/^["']|["']$/g, '')
  if (!visualPrompt) return NextResponse.json({ error: 'Model returned an empty prompt' }, { status: 502 })

  return NextResponse.json({ prompt: visualPrompt })
}
