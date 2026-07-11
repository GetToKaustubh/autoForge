import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { exchangeCodeForTokens, validateAndConsumeOAuthState } from '@/lib/auth/youtube-oauth'
import { encrypt } from '@/lib/utils/encryption'
import { db } from '@/lib/db'
import { organizations, users, youtubeChannels, auditLogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/utils/logger'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    logger.warn({ error }, 'YouTube OAuth denied by user')
    return NextResponse.redirect(`${APP_URL}/channels?error=oauth_denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/channels?error=invalid_callback`)
  }

  // Validate CSRF state
  const isValidState = await validateAndConsumeOAuthState(state)
  if (!isValidState) {
    logger.warn({ state }, 'YouTube OAuth invalid state token')
    return NextResponse.redirect(`${APP_URL}/channels?error=invalid_state`)
  }

  // Extract orgId from state (format: orgId:userId:nonce)
  const [orgId] = state.split(':')
  if (!orgId) {
    return NextResponse.redirect(`${APP_URL}/channels?error=invalid_state`)
  }

  // Verify Clerk session still valid
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.redirect(`${APP_URL}/sign-in`)
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)

    if (!tokens.refresh_token) {
      logger.error({ userId }, 'No refresh token in Google OAuth response — consent not granted')
      return NextResponse.redirect(`${APP_URL}/channels?error=no_refresh_token`)
    }

    // Fetch YouTube channel info
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    const channelData = await channelRes.json() as {
      items: Array<{
        id: string
        snippet: { title: string; customUrl: string; thumbnails: { default: { url: string } } }
        statistics: { subscriberCount: string; videoCount: string }
      }>
    }

    const ytChannel = channelData.items?.[0]
    if (!ytChannel) {
      return NextResponse.redirect(`${APP_URL}/channels?error=no_youtube_channel`)
    }

    // Resolve org DB id
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.clerkOrgId, orgId))
      .limit(1)

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1)

    if (!org || !user) {
      return NextResponse.redirect(`${APP_URL}/channels?error=org_not_found`)
    }

    // Encrypt tokens before storage — never store plaintext
    const accessTokenEnc = encrypt(tokens.access_token)
    const refreshTokenEnc = encrypt(tokens.refresh_token)
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    // Upsert YouTube channel record
    const [insertedChannel] = await db
      .insert(youtubeChannels)
      .values({
        organizationId: org.id,
        connectedBy: user.id,
        ytChannelId: ytChannel.id,
        channelName: ytChannel.snippet.title,
        channelHandle: ytChannel.snippet.customUrl,
        channelThumbnail: ytChannel.snippet.thumbnails.default.url,
        subscriberCount: parseInt(ytChannel.statistics.subscriberCount || '0'),
        videoCount: parseInt(ytChannel.statistics.videoCount || '0'),
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        tokenScope: tokens.scope,
        status: 'active',
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [youtubeChannels.organizationId, youtubeChannels.ytChannelId],
        set: {
          accessTokenEnc,
          refreshTokenEnc,
          tokenExpiresAt,
          tokenScope: tokens.scope,
          channelName: ytChannel.snippet.title,
          channelHandle: ytChannel.snippet.customUrl,
          channelThumbnail: ytChannel.snippet.thumbnails.default.url,
          subscriberCount: parseInt(ytChannel.statistics.subscriberCount || '0'),
          videoCount: parseInt(ytChannel.statistics.videoCount || '0'),
          status: 'active',
          lastSyncedAt: new Date(),
          deletedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: youtubeChannels.id })

    // Audit log
    await db.insert(auditLogs).values({
      organizationId: org.id,
      userId: user.id,
      action: 'channel.connected',
      resourceType: 'youtube_channel',
      resourceId: insertedChannel?.id,
      metadata: {
        ytChannelId: ytChannel.id,
        channelName: ytChannel.snippet.title,
      },
    })

    logger.info({ userId, ytChannelId: ytChannel.id }, 'YouTube channel connected successfully')
    return NextResponse.redirect(`${APP_URL}/channels?success=connected`)
  } catch (error) {
    logger.error({ error, userId }, 'YouTube OAuth callback error')
    return NextResponse.redirect(`${APP_URL}/channels?error=server_error`)
  }
}
