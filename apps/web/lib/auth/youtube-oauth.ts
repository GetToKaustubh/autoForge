import { encrypt, decrypt } from '@/lib/utils/encryption'
import { redis, cacheKeys } from '@/lib/cache/redis'
import { db } from '@/lib/db'
import { youtubeChannels } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/utils/logger'
import { randomBytes } from 'crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')

// ── OAuth Initiation ──────────────────────────────────────────────────────────

export function buildOAuthUrl(orgId: string, userId: string): { url: string; state: string } {
  const state = `${orgId}:${userId}:${randomBytes(16).toString('hex')}`

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',   // Force consent to always get refresh_token
    state,
  })

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    state,
  }
}

export async function saveOAuthState(state: string): Promise<void> {
  // Store state in Redis with 10-minute TTL for CSRF protection
  await redis.set(cacheKeys.oauthState(state), '1', { ex: 600 })
}

export async function validateAndConsumeOAuthState(state: string): Promise<boolean> {
  const key = cacheKeys.oauthState(state)
  const exists = await redis.get(key)
  if (!exists) return false
  await redis.del(key)  // Single use
  return true
}

// ── Token Exchange ────────────────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    logger.error({ error }, 'Google token exchange failed')
    throw new Error(`Token exchange failed: ${error}`)
  }

  return response.json() as Promise<GoogleTokenResponse>
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

interface RefreshTokenResult {
  accessToken: string
  expiresAt: Date
}

/**
 * Gets a valid access token for a channel.
 * Proactively refreshes if within 5 minutes of expiry.
 * This is the single entry point for all YouTube API calls that need auth.
 */
export async function getValidAccessToken(channelId: string): Promise<string> {
  const channel = await db.query.youtubeChannels.findFirst({
    where: eq(youtubeChannels.id, channelId),
    columns: {
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
    },
  })

  if (!channel) throw new Error(`Channel ${channelId} not found`)

  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)

  if (channel.tokenExpiresAt > fiveMinutesFromNow) {
    // Token still valid — decrypt and return
    return decrypt(channel.accessTokenEnc)
  }

  // Proactive refresh
  logger.info({ channelId }, 'Proactively refreshing YouTube access token')
  const refreshToken = decrypt(channel.refreshTokenEnc)
  const { accessToken, expiresAt } = await refreshAccessToken(refreshToken)

  await db
    .update(youtubeChannels)
    .set({
      accessTokenEnc: encrypt(accessToken),
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(youtubeChannels.id, channelId))

  return accessToken
}

async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResult> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    logger.error({ error }, 'Google token refresh failed')
    throw new Error(`Token refresh failed: ${error}`)
  }

  const data = (await response.json()) as GoogleTokenResponse
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

/**
 * Unconditionally refreshes the channel's access token (used by maintenance cron).
 * Unlike getValidAccessToken which only refreshes when near expiry, this always calls Google.
 */
export async function refreshChannelToken(channelId: string): Promise<void> {
  const channel = await db.query.youtubeChannels.findFirst({
    where: eq(youtubeChannels.id, channelId),
    columns: { refreshTokenEnc: true },
  })

  if (!channel) throw new Error(`Channel ${channelId} not found`)

  const refreshToken = decrypt(channel.refreshTokenEnc)
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token refresh failed: ${error}`)
  }

  const data = (await response.json()) as GoogleTokenResponse
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)

  await db
    .update(youtubeChannels)
    .set({
      accessTokenEnc: encrypt(data.access_token),
      tokenExpiresAt: expiresAt,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(youtubeChannels.id, channelId))
}

// ── Token Revocation ──────────────────────────────────────────────────────────

export async function revokeChannelTokens(channelId: string): Promise<void> {
  const channel = await db.query.youtubeChannels.findFirst({
    where: eq(youtubeChannels.id, channelId),
    columns: { refreshTokenEnc: true },
  })

  if (!channel) return

  try {
    const refreshToken = decrypt(channel.refreshTokenEnc)
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST',
    })
  } catch (error) {
    // Best effort — token may already be revoked
    logger.warn({ channelId, error }, 'Failed to revoke Google token (best effort)')
  }
}
