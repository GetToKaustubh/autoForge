import { getValidAccessToken } from '@/lib/auth/youtube-oauth'
import { checkAndDeductQuota } from '@/lib/utils/quota'
import { logger } from '@/lib/utils/logger'

const YT_API = 'https://www.googleapis.com/youtube/v3'
const YT_ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2'

async function ytFetch(
  url: string,
  accessToken: string,
  options?: RequestInit
): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`YouTube API error ${res.status}: ${err}`)
  }
  return res
}

export async function getChannelInfo(accessToken: string) {
  const res = await ytFetch(
    `${YT_API}/channels?part=snippet,statistics,contentDetails,brandingSettings&mine=true`,
    accessToken
  )
  const data = await res.json() as { items?: unknown[] }
  return (data.items?.[0] ?? null) as Record<string, unknown> | null
}

export async function getChannelById(ytChannelId: string, accessToken: string) {
  const res = await ytFetch(
    `${YT_API}/channels?part=snippet,statistics,contentDetails,brandingSettings&id=${ytChannelId}`,
    accessToken
  )
  const data = await res.json() as { items?: unknown[] }
  return (data.items?.[0] ?? null) as Record<string, unknown> | null
}

export async function updateVideoMetadata(
  dbChannelId: string,
  ytVideoId: string,
  metadata: Partial<{
    title: string
    description: string
    tags: string[]
    categoryId: string
    privacyStatus: 'private' | 'unlisted' | 'public'
  }>
) {
  const { allowed } = await checkAndDeductQuota(dbChannelId, 'videos.update')
  if (!allowed) throw new Error('YouTube quota exceeded for videos.update')

  const accessToken = await getValidAccessToken(dbChannelId)
  const res = await ytFetch(`${YT_API}/videos?part=snippet,status`, accessToken, {
    method: 'PUT',
    body: JSON.stringify({
      id: ytVideoId,
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId ?? '22',
      },
      status: metadata.privacyStatus ? { privacyStatus: metadata.privacyStatus } : undefined,
    }),
  })
  return res.json()
}

export async function searchVideos(
  dbChannelId: string,
  query: string,
  maxResults = 10
): Promise<unknown[]> {
  const { allowed } = await checkAndDeductQuota(dbChannelId, 'search.list')
  if (!allowed) throw new Error('YouTube quota exceeded for search.list')

  const accessToken = await getValidAccessToken(dbChannelId)
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults),
    relevanceLanguage: 'en',
    order: 'relevance',
  })
  const res = await ytFetch(`${YT_API}/search?${params}`, accessToken)
  const data = await res.json() as { items?: unknown[] }
  return data.items ?? []
}

export async function getVideoAnalytics(
  dbChannelId: string,
  ytChannelId: string,
  startDate: string,
  endDate: string
) {
  const accessToken = await getValidAccessToken(dbChannelId)
  const params = new URLSearchParams({
    ids: `channel==${ytChannelId}`,
    startDate,
    endDate,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,estimatedRevenue,impressions,impressionClickThroughRate',
    dimensions: 'day',
    sort: 'day',
  })
  const res = await ytFetch(`${YT_ANALYTICS_API}/reports?${params}`, accessToken)
  return res.json()
}

export async function getVideoList(
  dbChannelId: string,
  playlistId: string,
  pageToken?: string
) {
  const accessToken = await getValidAccessToken(dbChannelId)
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: '50',
    ...(pageToken ? { pageToken } : {}),
  })
  const res = await ytFetch(`${YT_API}/playlistItems?${params}`, accessToken)
  return res.json()
}

export async function uploadVideoResumable(
  dbChannelId: string,
  videoBuffer: Buffer,
  metadata: {
    title: string
    description: string
    tags: string[]
    categoryId?: string
    privacyStatus?: 'private' | 'unlisted' | 'public'
    scheduledFor?: Date
  }
): Promise<{ id: string }> {
  const { allowed, remainingQuota, cost } = await checkAndDeductQuota(dbChannelId, 'videos.insert')
  if (!allowed) {
    throw new Error(`YouTube quota exceeded. Remaining: ${remainingQuota}, Cost: ${cost}`)
  }

  const accessToken = await getValidAccessToken(dbChannelId)

  const publishAt =
    metadata.privacyStatus === 'public' && metadata.scheduledFor
      ? metadata.scheduledFor.toISOString()
      : undefined

  const videoMetadata = {
    snippet: {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: metadata.categoryId ?? '22',
    },
    status: {
      privacyStatus: publishAt ? 'private' : (metadata.privacyStatus ?? 'private'),
      publishAt,
      selfDeclaredMadeForKids: false,
    },
  }

  // Initiate resumable upload
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(videoBuffer.length),
      },
      body: JSON.stringify(videoMetadata),
    }
  )

  if (!initRes.ok) {
    throw new Error(`YouTube upload init failed: ${initRes.status}`)
  }

  const uploadUrl = initRes.headers.get('Location')
  if (!uploadUrl) throw new Error('No upload URL in YouTube response')

  // Upload the video binary
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(videoBuffer.length),
    },
    body: videoBuffer as unknown as BodyInit,
  })

  if (!uploadRes.ok) {
    throw new Error(`YouTube video upload failed: ${uploadRes.status}`)
  }

  const result = await uploadRes.json() as { id: string }
  logger.info({ videoId: result.id, dbChannelId }, 'YouTube video uploaded')
  return result
}
