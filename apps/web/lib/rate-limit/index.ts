import { Ratelimit } from '@upstash/ratelimit'
import { redis } from '@/lib/cache/redis'
import { NextResponse } from 'next/server'

export const rateLimiters = {
  // General API routes: 100 req/min per user
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    prefix: 'rl:api',
    analytics: true,
  }),

  // AI generation routes: 10 req/min per org (expensive operations)
  aiGeneration: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'rl:ai',
    analytics: true,
  }),

  // YouTube upload routes: 6 per 24h per channel (aligned with quota)
  uploads: new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(6, '24 h'),
    prefix: 'rl:upload',
    analytics: true,
  }),

  // YouTube OAuth connect: 5 per hour per user
  oauthConnect: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    prefix: 'rl:oauth',
    analytics: true,
  }),

  // Team invites: 20 per day per org
  teamInvites: new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(20, '24 h'),
    prefix: 'rl:invite',
    analytics: true,
  }),
}

/**
 * Applies rate limiting and returns a 429 response if exceeded.
 * Returns null if the request is allowed.
 */
export async function applyRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<NextResponse | null> {
  const { success, limit, reset, remaining } = await limiter.limit(identifier)

  if (!success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
          'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    )
  }

  return null
}
