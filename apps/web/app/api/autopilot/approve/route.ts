import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channelAutopilotRuns, videos, youtubeChannels } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { tasks, TASK_IDS } from '@/lib/queue/client'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'

function page(title: string, message: string, tone: 'success' | 'error' = 'success') {
  const color = tone === 'success' ? '#16a34a' : '#dc2626'
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;">
  <div style="max-width: 420px; text-align: center; padding: 32px;">
    <h1 style="color: ${color}; font-size: 22px;">${title}</h1>
    <p style="color: #a3a3a3; line-height: 1.5;">${message}</p>
  </div>
</body></html>`
}

function htmlResponse(html: string, status = 200) {
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: NextRequest) {
  const rateLimitRes = await applyRateLimit(rateLimiters.api, `autopilot-approve:${req.headers.get('x-forwarded-for') ?? 'unknown'}`)
  if (rateLimitRes) return rateLimitRes

  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  const action = searchParams.get('action')

  if (!token || (action !== 'approve' && action !== 'reject')) {
    return htmlResponse(page('Invalid link', 'This link is missing required parameters.', 'error'), 400)
  }

  const [run] = await db
    .select()
    .from(channelAutopilotRuns)
    .where(eq(channelAutopilotRuns.approvalToken, token))
    .limit(1)

  if (!run) {
    return htmlResponse(page('Link not found', 'This review link is invalid or has already been used.', 'error'), 404)
  }
  if (run.status !== 'awaiting_review') {
    return htmlResponse(page('Already handled', `This video was already ${run.status === 'completed' ? 'approved' : run.status === 'discarded' ? 'discarded' : 'processed'}.`, 'error'), 409)
  }
  if (!run.approvalTokenExpiresAt || run.approvalTokenExpiresAt < new Date()) {
    return htmlResponse(page('Link expired', 'This review link has expired (links are valid for 7 days).', 'error'), 410)
  }
  if (!run.videoId) {
    return htmlResponse(page('No video found', 'This run has no associated video.', 'error'), 404)
  }

  if (action === 'reject') {
    await db
      .update(channelAutopilotRuns)
      .set({ status: 'discarded', approvalToken: null, approvalTokenExpiresAt: null, completedAt: new Date() })
      .where(eq(channelAutopilotRuns.id, run.id))

    return htmlResponse(page('Discarded', 'The video was discarded and will not be uploaded. It remains in your dashboard if you want to review it manually.'))
  }

  const [video] = await db.select({ id: videos.id, channelId: videos.channelId, title: videos.title }).from(videos).where(eq(videos.id, run.videoId)).limit(1)
  if (!video) {
    return htmlResponse(page('Video not found', 'The video for this run could not be found.', 'error'), 404)
  }
  const [channel] = await db.select({ organizationId: youtubeChannels.organizationId }).from(youtubeChannels).where(eq(youtubeChannels.id, video.channelId)).limit(1)
  if (!channel) {
    return htmlResponse(page('Channel not found', 'The channel for this video could not be found.', 'error'), 404)
  }

  await tasks.trigger(TASK_IDS.YOUTUBE_UPLOAD, {
    videoId: video.id,
    channelId: video.channelId,
    organizationId: channel.organizationId,
  })

  await db
    .update(channelAutopilotRuns)
    .set({ status: 'completed', approvalToken: null, approvalTokenExpiresAt: null, completedAt: new Date() })
    .where(eq(channelAutopilotRuns.id, run.id))

  return htmlResponse(page('Approved — uploading now', `"${video.title}" is being uploaded to YouTube. It'll appear on your channel shortly.`))
}
