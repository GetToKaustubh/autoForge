import { Resend } from 'resend'

let _client: Resend | null = null

function getClient(): Resend {
  if (!_client) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
    _client = new Resend(process.env.RESEND_API_KEY)
  }
  return _client
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'TubeForge <noreply@tubeforge.app>'

export async function sendTeamInviteEmail(options: {
  to: string
  inviterName: string
  orgName: string
  role: string
  acceptUrl: string
  expiresInDays: number
}) {
  const client = getClient()
  const res = await client.emails.send({
    from: FROM_ADDRESS,
    to: options.to,
    subject: `You've been invited to ${options.orgName} on TubeForge`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You've been invited to TubeForge</h2>
        <p><strong>${options.inviterName}</strong> has invited you to join <strong>${options.orgName}</strong> as a <strong>${options.role}</strong>.</p>
        <p>
          <a href="${options.acceptUrl}" style="background-color: #FF0000; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Accept Invitation
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This invitation expires in ${options.expiresInDays} days.</p>
        <p style="color: #666; font-size: 14px;">If you weren't expecting this invitation, you can safely ignore this email.</p>
      </div>
    `,
  })
  return res
}

export async function sendUploadSuccessEmail(options: {
  to: string
  videoTitle: string
  ytUrl: string
  channelName: string
}) {
  const client = getClient()
  return client.emails.send({
    from: FROM_ADDRESS,
    to: options.to,
    subject: `Video published: "${options.videoTitle}"`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your video is live!</h2>
        <p>Your video <strong>${options.videoTitle}</strong> has been published to <strong>${options.channelName}</strong>.</p>
        <p>
          <a href="${options.ytUrl}" style="background-color: #FF0000; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View on YouTube
          </a>
        </p>
      </div>
    `,
  })
}

export async function sendUploadFailureEmail(options: {
  to: string
  videoTitle: string
  errorMessage: string
  dashboardUrl: string
}) {
  const client = getClient()
  return client.emails.send({
    from: FROM_ADDRESS,
    to: options.to,
    subject: `Upload failed: "${options.videoTitle}"`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Upload Failed</h2>
        <p>We encountered an error while uploading <strong>${options.videoTitle}</strong> to YouTube.</p>
        <p><strong>Error:</strong> ${options.errorMessage}</p>
        <p>
          <a href="${options.dashboardUrl}" style="background-color: #1a1a1a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Dashboard
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Please check your channel quota and try again.</p>
      </div>
    `,
  })
}
