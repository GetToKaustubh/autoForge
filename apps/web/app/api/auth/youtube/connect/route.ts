import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { buildOAuthUrl, saveOAuthState } from '@/lib/auth/youtube-oauth'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { getOrgMember } from '@/lib/auth/get-member'
import { enforceChannelLimit } from '@/lib/utils/plan-enforcement'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitResult = await applyRateLimit(rateLimiters.oauthConnect, userId)
  if (rateLimitResult) return rateLimitResult

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const limitErr = await enforceChannelLimit(member.orgDbId)
  if (limitErr) return limitErr

  const { url, state } = buildOAuthUrl(orgId, userId)
  await saveOAuthState(state)

  logger.info({ userId, orgId }, 'YouTube OAuth initiated')
  return NextResponse.redirect(url)
}
