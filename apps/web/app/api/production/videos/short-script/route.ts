import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videoIdeas, scripts, youtubeChannels } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { tasks, TASK_IDS } from '@/lib/queue/client'
import { generateText } from '@/lib/services/gemini'

const bodySchema = z.object({
  channelId: z.string().uuid(),
  topic: z.string().min(3).max(300),
  tone: z.string().max(100).optional(),
  targetDurationSec: z.number().int().min(15).max(60).default(45),
})

// Quick-start for the New Short flow: "enter a topic, get a script" in one
// step instead of the full niche/keyword/idea-generation research pipeline
// New Video expects. Runs one Gemini call to turn the topic into a proper
// idea (title/hook/keywords), reuses that same video_ideas row exactly like
// the existing ideas flow, then triggers the existing script-generation
// task - no new AI pipeline, just a shorter on-ramp into the same one.
export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.aiGeneration, `${orgId}:short-script`)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const detail = firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Invalid request'
    return NextResponse.json({ error: detail, details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(
      eq(youtubeChannels.id, parsed.data.channelId),
      eq(youtubeChannels.organizationId, member.orgDbId),
      isNull(youtubeChannels.deletedAt),
    ))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const ideaPrompt = `Turn this YouTube Shorts topic into a video idea: "${parsed.data.topic}"

Return JSON:
{
  "title": "string, punchy, under 80 chars, hook-forward",
  "hook": "string, 1 sentence, the first thing said on screen",
  "targetKeywords": ["string", "3-6 short keywords"]
}`

  const ideaResult = await generateText(
    ideaPrompt,
    'You are a YouTube Shorts strategist writing viral, retention-optimized hooks. Respond with valid JSON only.',
    { temperature: 0.7, maxOutputTokens: 400, responseFormat: 'json' }
  )

  let ideaData: { title: string; hook: string; targetKeywords: string[] }
  try {
    const cleaned = ideaResult.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    ideaData = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'Model returned invalid JSON' }, { status: 502 })
  }
  if (!ideaData.title) {
    return NextResponse.json({ error: 'Model did not return a usable idea' }, { status: 502 })
  }

  const [idea] = await db
    .insert(videoIdeas)
    .values({
      organizationId: member.orgDbId,
      channelId: parsed.data.channelId,
      createdBy: member.userDbId,
      title: ideaData.title,
      hook: ideaData.hook,
      targetKeywords: ideaData.targetKeywords ?? [],
      format: 'shorts',
      status: 'approved',
    })
    .returning()

  if (!idea) return NextResponse.json({ error: 'Failed to create idea' }, { status: 500 })

  const [script] = await db
    .insert(scripts)
    .values({
      organizationId: member.orgDbId,
      channelId: parsed.data.channelId,
      ideaId: idea.id,
      createdBy: member.userDbId,
      title: idea.title,
      status: 'draft',
    })
    .returning()

  if (!script) return NextResponse.json({ error: 'Failed to create script' }, { status: 500 })

  const handle = await tasks.trigger(TASK_IDS.SCRIPT_GENERATION, {
    scriptId: script.id,
    ideaId: idea.id,
    organizationId: member.orgDbId,
    targetDurationSec: parsed.data.targetDurationSec,
    tone: parsed.data.tone ?? 'punchy, fast-paced, energetic — written for YouTube Shorts',
  })

  const [updated] = await db
    .update(scripts)
    .set({ triggerJobId: handle.id })
    .where(eq(scripts.id, script.id))
    .returning()

  return NextResponse.json({ ...updated, ideaId: idea.id, generating: true }, { status: 201 })
}
