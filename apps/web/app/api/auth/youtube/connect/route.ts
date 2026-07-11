import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { buildOAuthUrl, saveOAuthState } from '@/lib/auth/youtube-oauth'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit: 5 OAuth initiations per hour per user
  const rateLimitResult = await applyRateLimit(rateLimiters.oauthConnect, userId)
  if (rateLimitResult) return rateLimitResult

  const { url, state } = buildOAuthUrl(orgId, userId)
  await saveOAuthState(state)

  logger.info({ userId, orgId }, 'YouTube OAuth initiated')
  return NextResponse.redirect(url)
}
