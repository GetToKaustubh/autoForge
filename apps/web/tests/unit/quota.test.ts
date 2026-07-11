import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mocks declared before any imports that use them ---

const mockFindFirst = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      youtubeChannels: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}))

const mockExists = vi.fn()
const mockSet = vi.fn()
const mockDecrby = vi.fn()
const mockIncrby = vi.fn()

vi.mock('@/lib/cache/redis', () => ({
  redis: {
    exists: (...args: unknown[]) => mockExists(...args),
    set: (...args: unknown[]) => mockSet(...args),
    decrby: (...args: unknown[]) => mockDecrby(...args),
    incrby: (...args: unknown[]) => mockIncrby(...args),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  youtubeChannels: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))

// stable date so key is predictable
vi.mock('date-fns', () => ({
  format: () => '2026-07-12',
}))

import { checkAndDeductQuota, todayPacificDate, QUOTA_COSTS } from '@/lib/utils/quota'

const CHANNEL_ID = 'chan_abc'

function makeChannel(quotaUsed = 0, quotaLimit = 10000) {
  return { quotaUsedToday: quotaUsed, quotaLimitDaily: quotaLimit, quotaResetAt: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue(makeChannel())
  mockExists.mockResolvedValue(0)
  mockSet.mockResolvedValue('OK')
  mockDecrby.mockResolvedValue(9900) // 10000 - 100 (search.list)
  mockIncrby.mockResolvedValue(10000)
})

describe('checkAndDeductQuota', () => {
  it('allows operation when quota available', async () => {
    mockDecrby.mockResolvedValue(9900)

    const result = await checkAndDeductQuota(CHANNEL_ID, 'search.list')

    expect(result.allowed).toBe(true)
    expect(result.cost).toBe(100)
    expect(result.remainingQuota).toBe(9900)
  })

  it('initialises Redis key when missing', async () => {
    mockExists.mockResolvedValue(0)
    mockDecrby.mockResolvedValue(9900)

    await checkAndDeductQuota(CHANNEL_ID, 'search.list')

    expect(mockSet).toHaveBeenCalledWith(
      `quota:${CHANNEL_ID}:2026-07-12`,
      10000,
      { ex: 90000 },
    )
  })

  it('skips Redis init when key already exists', async () => {
    mockExists.mockResolvedValue(1)
    mockDecrby.mockResolvedValue(9900)

    await checkAndDeductQuota(CHANNEL_ID, 'search.list')

    expect(mockSet).not.toHaveBeenCalled()
  })

  it('denies operation when quota would go negative', async () => {
    mockFindFirst.mockResolvedValue(makeChannel(9999, 10000))
    // remaining after init = 1; decrby 100 => -99
    mockDecrby.mockResolvedValue(-99)

    const result = await checkAndDeductQuota(CHANNEL_ID, 'search.list')

    expect(result.allowed).toBe(false)
    expect(result.remainingQuota).toBe(1) // rolled back: -99 + 100
    // Redis rollback called
    expect(mockIncrby).toHaveBeenCalledWith(`quota:${CHANNEL_ID}:2026-07-12`, 100)
  })

  it('throws when channel not found', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(checkAndDeductQuota('no-such-channel', 'channels.list')).rejects.toThrow(
      'Channel no-such-channel not found',
    )
  })

  it('uses correct cost for videos.insert', async () => {
    mockDecrby.mockResolvedValue(8400)

    const result = await checkAndDeductQuota(CHANNEL_ID, 'videos.insert')

    expect(result.cost).toBe(1600)
    expect(mockDecrby).toHaveBeenCalledWith(`quota:${CHANNEL_ID}:2026-07-12`, 1600)
  })

  it('uses correct cost for thumbnails.set', async () => {
    mockDecrby.mockResolvedValue(9950)

    const result = await checkAndDeductQuota(CHANNEL_ID, 'thumbnails.set')

    expect(result.cost).toBe(50)
  })
})

describe('QUOTA_COSTS', () => {
  it('has expected values', () => {
    expect(QUOTA_COSTS['videos.insert']).toBe(1600)
    expect(QUOTA_COSTS['search.list']).toBe(100)
    expect(QUOTA_COSTS['channels.list']).toBe(1)
    expect(QUOTA_COSTS['videos.update']).toBe(50)
    expect(QUOTA_COSTS['captions.insert']).toBe(400)
  })
})

describe('todayPacificDate', () => {
  it('returns YYYY-MM-DD string', () => {
    const result = todayPacificDate()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
