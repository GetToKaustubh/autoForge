import { task, logger } from '@trigger.dev/sdk'

export type NotificationType =
  | 'upload_success'
  | 'upload_failure'
  | 'team_invite'
  | 'quota_warning'
  | 'pipeline_complete'
  | 'pipeline_failed'
  | 'review_needed'

interface NotificationPayload {
  to: string
  type: NotificationType
  data: Record<string, string | number | boolean>
}

export const sendNotificationTask = task({
  id: 'send-notification',
  maxDuration: 60,

  run: async (payload: NotificationPayload) => {
    const { to, type, data } = payload

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error('RESEND_API_KEY not set')
    const FROM = process.env.EMAIL_FROM ?? 'TubeForge <noreply@tubeforge.app>'

    let subject: string
    let html: string

    switch (type) {
      case 'upload_success':
        subject = `Video published: "${data.videoTitle}"`
        html = `<h2>Your video is live!</h2><p><strong>${data.videoTitle}</strong> published to <strong>${data.channelName}</strong>.</p><p><a href="${data.ytUrl}" style="background:#FF0000;color:white;padding:12px 24px;text-decoration:none;border-radius:6px">View on YouTube</a></p>`
        break
      case 'upload_failure':
        subject = `Upload failed: "${data.videoTitle}"`
        html = `<h2>Upload Failed</h2><p>Error uploading <strong>${data.videoTitle}</strong>: ${data.errorMessage}</p><p><a href="${data.dashboardUrl}">View Dashboard</a></p>`
        break
      case 'team_invite':
        subject = `You're invited to ${data.orgName} on TubeForge`
        html = `<h2>Team Invitation</h2><p><strong>${data.inviterName}</strong> invited you to join <strong>${data.orgName}</strong> as ${data.role}.</p><p><a href="${data.acceptUrl}" style="background:#FF0000;color:white;padding:12px 24px;text-decoration:none;border-radius:6px">Accept Invitation</a></p><p style="color:#666;font-size:14px">Expires in ${data.expiresInDays} days.</p>`
        break
      case 'quota_warning':
        subject = `YouTube quota warning: ${data.channelName}`
        html = `<h2>Quota Warning</h2><p>Channel <strong>${data.channelName}</strong> has used ${data.percentUsed}% of its daily quota.</p>`
        break
      case 'pipeline_complete':
        subject = `Pipeline complete: "${data.videoTitle}"`
        html = `<h2>Video Ready</h2><p><strong>${data.videoTitle}</strong> completed all pipeline stages.</p><p><a href="${data.dashboardUrl}">View Video</a></p>`
        break
      case 'pipeline_failed':
        subject = `Pipeline failed: "${data.videoTitle}"`
        html = `<h2>Pipeline Failed</h2><p><strong>${data.videoTitle}</strong> failed at stage: <strong>${data.failedStage}</strong>. Error: ${data.errorMessage}</p><p><a href="${data.dashboardUrl}">Retry</a></p>`
        break
      case 'review_needed':
        subject = `Ready to review: "${data.videoTitle}"`
        html = `<h2>Your autopilot video is ready</h2><p><strong>${data.videoTitle}</strong> for <strong>${data.channelName}</strong> finished the full pipeline and is waiting for your review.</p>${data.thumbnailUrl ? `<p><img src="${data.thumbnailUrl}" alt="thumbnail" style="max-width:400px;border-radius:8px" /></p>` : ''}<p><a href="${data.approveUrl}" style="background:#16a34a;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-right:12px">Approve &amp; Publish</a><a href="${data.rejectUrl}" style="background:#dc2626;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">Discard</a></p><p style="color:#666;font-size:14px">This link expires in 7 days.</p>`
        break
      default:
        throw new Error(`Unknown notification type: ${type}`)
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Resend API error: ${res.status} — ${err}`)
    }

    const result = await res.json() as { id: string }
    logger.info(`Notification sent: type=${type} to=${to} emailId=${result.id}`)
    return { emailId: result.id }
  },
})
