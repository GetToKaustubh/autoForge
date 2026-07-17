import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channelAutopilotRuns, videos, thumbnails } from '@/lib/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { getOrgMember } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'

export async function GET(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { channelId } = await params

  const rows = await db
    .select({
      id: channelAutopilotRuns.id,
      status: channelAutopilotRuns.status,
      stage: channelAutopilotRuns.stage,
      costUsd: channelAutopilotRuns.costUsd,
      errorMessage: channelAutopilotRuns.errorMessage,
      startedAt: channelAutopilotRuns.startedAt,
      completedAt: channelAutopilotRuns.completedAt,
      videoId: channelAutopilotRuns.videoId,
      videoTitle: videos.title,
      ytUrl: videos.ytUrl,
      thumbnailUrl: thumbnails.selectedUrl,
    })
    .from(channelAutopilotRuns)
    .leftJoin(videos, eq(videos.id, channelAutopilotRuns.videoId))
    .leftJoin(thumbnails, eq(thumbnails.id, videos.thumbnailId))
    .where(and(eq(channelAutopilotRuns.channelId, channelId), eq(channelAutopilotRuns.organizationId, member.orgDbId)))
    .orderBy(desc(channelAutopilotRuns.startedAt))
    .limit(10)

  return NextResponse.json({ runs: rows })
}
