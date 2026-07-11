import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Cache key factories — keeps key format consistent across the app
export const cacheKeys = {
  quota: (channelId: string, date: string) => `quota:${channelId}:${date}`,
  oauthState: (state: string) => `oauth:state:${state}`,
  researchResult: (id: string) => `research:${id}`,
  keywordResults: (seedKeyword: string, orgId: string) =>
    `keywords:${orgId}:${seedKeyword.toLowerCase().replace(/\s+/g, '-')}`,
  trendResults: (topic: string, orgId: string) =>
    `trends:${orgId}:${topic.toLowerCase().replace(/\s+/g, '-')}`,
  channelInfo: (channelId: string) => `channel:${channelId}:info`,
  analyticsOverview: (orgId: string) => `analytics:${orgId}:overview`,
} as const
