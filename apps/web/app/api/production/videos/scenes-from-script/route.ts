import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scripts } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { planStockScenes } from '@/lib/services/scene-planning'

const bodySchema = z.object({
  scriptId: z.string().uuid(),
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

  try {
    const scenes = await planStockScenes({ scriptFullText: script.fullText, totalDurationSec: totalDuration })
    return NextResponse.json({ scenes })
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Model returned invalid JSON' }, { status: 502 })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Model output failed validation', details: err.flatten() }, { status: 502 })
    }
    throw err
  }
}
