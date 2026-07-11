import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be declared before imports that use them

const mockRedisGet = vi.fn()
const mockRedisSet = vi.fn()
const mockRedisDel = vi.fn()

vi.mock('@/lib/cache/redis', () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
  cacheKeys: {
    oauthState: (state: string) => `oauth:state:${state}`,
  },
}))

vi.mock('@/lib/db', () => ({
  db: { query: { youtubeChannels: { findFirst: vi.fn() } }, update: vi.fn() },
}))
vi.mock('@/lib/db/schema', () => ({ youtubeChannels: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/utils/encryption', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}))
vi.mock('@/lib/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/auth/youtube/callback'

import { buildOAuthUrl, saveOAuthState, validateAndConsumeOAuthState, YOUTUBE_SCOPES } from '@/lib/auth/youtube-oauth'

beforeEach(() => vi.clearAllMocks())

describe('buildOAuthUrl', () => {
  it('returns a valid Google OAuth URL', () => {
    const { url, state } = buildOAuthUrl('org_123', 'user_456')
    expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/)
  })

  it('URL contains required params', () => {
    const { url } = buildOAuthUrl('org_123', 'user_456')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/youtube/callback')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
  })

  it('URL scope includes all required YouTube scopes', () => {
    const { url } = buildOAuthUrl('org_123', 'user_456')
    const parsed = new URL(url)
    const scope = parsed.searchParams.get('scope') ?? ''
    expect(scope).toContain('youtube')
    expect(scope).toContain('yt-analytics.readonly')
    expect(scope).toContain('yt-analytics-monetary.readonly')
  })

  it('state embeds orgId and userId', () => {
    const { state } = buildOAuthUrl('org_abc', 'user_xyz')
    const [orgPart, userPart] = state.split(':')
    expect(orgPart).toBe('org_abc')
    expect(userPart).toBe('user_xyz')
  })

  it('state has nonce (32 hex chars)', () => {
    const { state } = buildOAuthUrl('org_abc', 'user_xyz')
    const parts = state.split(':')
    expect(parts).toHaveLength(3)
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates unique state each call', () => {
    const { state: a } = buildOAuthUrl('org_1', 'user_1')
    const { state: b } = buildOAuthUrl('org_1', 'user_1')
    expect(a).not.toBe(b)
  })

  it('state in URL matches returned state', () => {
    const { url, state } = buildOAuthUrl('org_123', 'user_456')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('state')).toBe(state)
  })
})

describe('saveOAuthState', () => {
  it('stores state in Redis with 10-minute TTL', async () => {
    mockRedisSet.mockResolvedValue('OK')
    const state = 'org_1:user_1:deadbeef'
    await saveOAuthState(state)
    expect(mockRedisSet).toHaveBeenCalledWith(`oauth:state:${state}`, '1', { ex: 600 })
  })
})

describe('validateAndConsumeOAuthState', () => {
  it('returns true and deletes key for valid state', async () => {
    mockRedisGet.mockResolvedValue('1')
    mockRedisDel.mockResolvedValue(1)

    const state = 'org_1:user_1:deadbeef'
    const result = await validateAndConsumeOAuthState(state)

    expect(result).toBe(true)
    expect(mockRedisDel).toHaveBeenCalledWith(`oauth:state:${state}`)
  })

  it('returns false for missing/expired state', async () => {
    mockRedisGet.mockResolvedValue(null)

    const result = await validateAndConsumeOAuthState('expired-state')

    expect(result).toBe(false)
    expect(mockRedisDel).not.toHaveBeenCalled()
  })

  it('is single-use — del called exactly once', async () => {
    mockRedisGet.mockResolvedValue('1')
    mockRedisDel.mockResolvedValue(1)

    await validateAndConsumeOAuthState('org:user:abc')
    expect(mockRedisDel).toHaveBeenCalledTimes(1)
  })
})

describe('YOUTUBE_SCOPES', () => {
  it('is a space-separated string', () => {
    expect(typeof YOUTUBE_SCOPES).toBe('string')
    expect(YOUTUBE_SCOPES.split(' ').length).toBeGreaterThan(1)
  })

  it('includes youtube write scope', () => {
    expect(YOUTUBE_SCOPES).toContain('https://www.googleapis.com/auth/youtube')
  })

  it('includes monetary analytics scope', () => {
    expect(YOUTUBE_SCOPES).toContain('yt-analytics-monetary.readonly')
  })
})
