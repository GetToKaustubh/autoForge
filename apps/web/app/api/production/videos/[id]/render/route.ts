import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { videos, voiceGenerations } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'
import { tasks, TASK_IDS } from '@/lib/queue/client'

const renderSchema = z.object({
  addCaptions: z.boolean().default(false),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = renderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [video] = await db
    .select({
      id: videos.id,
      pipelineStage: videos.pipelineStage,
      voiceGenId: videos.voiceGenId,
      organizationId: videos.organizationId,
    })
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.organizationId, member.orgDbId), isNull(videos.deletedAt)))
    .limit(1)

  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (video.pipelineStage !== 'scenes_ready') {
    return NextResponse.json(
      { error: `Cannot render: video must be in scenes_ready stage (currently: ${video.pipelineStage})` },
      { status: 409 }
    )
  }

  // Fetch voice audio URL if voice gen exists
  let voiceAudioUrl: string | undefined
  if (video.voiceGenId) {
    const [voiceGen] = await db
      .select({ fullAudioUrl: voiceGenerations.fullAudioUrl, status: voiceGenerations.status })
      .from(voiceGenerations)
      .where(eq(voiceGenerations.id, video.voiceGenId))
      .limit(1)

    if (voiceGen?.status === 'completed' && voiceGen.fullAudioUrl) {
      voiceAudioUrl = voiceGen.fullAudioUrl
    }
  }

  await db
    .update(videos)
    .set({ pipelineStage: 'render_queue', updatedAt: new Date() })
    .where(eq(videos.id, id))

  const handle = await tasks.trigger(TASK_IDS.VIDEO_PIPELINE, {
    videoId: id,
    organizationId: member.orgDbId,
    voiceAudioUrl,
    addCaptions: parsed.data.addCaptions,
  })

  return NextResponse.json({ videoId: id, triggerJobId: handle.id, stage: 'render_queue' }, { status: 202 })
}
