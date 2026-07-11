import { task, logger } from '@trigger.dev/sdk/v3'
import { z } from 'zod'

const uploadPayloadSchema = z.object({
  videoId: z.string().uuid(),
  channelId: z.string().uuid(),
  organizationId: z.string().uuid(),
  scheduledUploadId: z.string().uuid().optional(),
  publishAt: z.string().optional(), // ISO datetime for scheduled publish
})

export type YouTubeUploadPayload = z.infer<typeof uploadPayloadSchema>

export const youtubeUploadTask = task({
  id: 'youtube-upload',
  maxDuration: 3600, // 60 min for large file uploads
  retry: { maxAttempts: 2, minTimeoutInMs: 10000 },

  run: async (rawPayload: YouTubeUploadPayload) => {
    const payload = uploadPayloadSchema.parse(rawPayload)
    logger.info(`Starting YouTube upload for ${payload.videoId}`)

    const { db } = await import('../../lib/db')
    const { videos, youtubeChannels, scheduledUploads, auditLogs, apiUsage } = await import(
      '../../lib/db/schema'
    )
    const { eq } = await import('drizzle-orm')
    const { getValidAccessToken } = await import('../../lib/auth/youtube-oauth')
    const { checkAndDeductQuota } = await import('../../lib/utils/quota')

    // Fetch video + channel
    const [video] = await db.select().from(videos).where(eq(videos.id, payload.videoId)).limit(1)
    if (!video) throw new Error(`Video ${payload.videoId} not found`)
    if (!video.finalVideoUrl) throw new Error('Video has no final_video_url — render first')

    const [channel] = await db
      .select()
      .from(youtubeChannels)
      .where(eq(youtubeChannels.id, payload.channelId))
      .limit(1)
    if (!channel) throw new Error(`Channel ${payload.channelId} not found`)

    // Check quota (1,600 units for upload)
    const { allowed, remainingQuota } = await checkAndDeductQuota(
      payload.channelId,
      'videos.insert'
    )
    if (!allowed) {
      throw new Error(
        `YouTube quota exceeded for channel ${channel.channelName}. Remaining: ${remainingQuota}`
      )
    }

    // Get valid (refreshed if needed) access token
    const accessToken = await getValidAccessToken(payload.channelId)

    // Fetch the final video from Cloudinary
    const videoResponse = await fetch(video.finalVideoUrl)
    if (!videoResponse.ok) throw new Error('Failed to fetch video from Cloudinary')

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
    const videoSize = videoBuffer.length

    logger.info(`Fetched video for ${payload.videoId}: ${Math.round(videoSize / 1024 / 1024)}MB, starting resumable upload`)

    // Initiate resumable upload session
    const metadata = {
      snippet: {
        title: video.ytTitle ?? video.title,
        description: video.ytDescription ?? video.description ?? '',
        tags: video.ytTags ?? [],
        categoryId: video.ytCategoryId ?? '22', // People & Blogs
        defaultLanguage: video.ytLanguage ?? 'en',
      },
      status: {
        privacyStatus: payload.publishAt ? 'private' : (video.ytVisibility ?? 'private'),
        publishAt: payload.publishAt,
        madeForKids: video.ytMadeForKids ?? false,
      },
    }

    const initResponse = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': videoSize.toString(),
        },
        body: JSON.stringify(metadata),
      }
    )

    if (!initResponse.ok) {
      const err = await initResponse.text()
      throw new Error(`Failed to initiate YouTube upload: ${err}`)
    }

    const uploadUrl = initResponse.headers.get('Location')
    if (!uploadUrl) throw new Error('No upload URL in YouTube response')

    // Upload video bytes
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoSize.toString(),
      },
      body: videoBuffer,
    })

    if (!uploadResponse.ok) {
      const err = await uploadResponse.text()
      throw new Error(`YouTube upload failed: ${err}`)
    }

    const uploadResult = await uploadResponse.json() as { id: string; status: { uploadStatus: string } }
    const ytVideoId = uploadResult.id

    // Update video record
    await db
      .update(videos)
      .set({
        ytVideoId,
        ytUrl: `https://www.youtube.com/watch?v=${ytVideoId}`,
        pipelineStage: 'uploaded',
        uploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videos.id, payload.videoId))

    // Update scheduled upload if applicable
    if (payload.scheduledUploadId) {
      await db
        .update(scheduledUploads)
        .set({ status: 'uploaded', updatedAt: new Date() })
        .where(eq(scheduledUploads.id, payload.scheduledUploadId))
    }

    // Audit log
    await db.insert(auditLogs).values({
      organizationId: payload.organizationId,
      action: 'video.uploaded',
      resourceType: 'video',
      resourceId: payload.videoId,
      metadata: { ytVideoId, ytUrl: `https://www.youtube.com/watch?v=${ytVideoId}` },
    })

    // Record API usage (1,600 units)
    await db.insert(apiUsage).values({
      organizationId: payload.organizationId,
      service: 'youtube',
      endpoint: 'videos.insert',
      unitsUsed: '1600',
      unitType: 'units',
      resourceType: 'video',
      resourceId: payload.videoId,
    })

    logger.info(`YouTube upload completed for ${payload.videoId}: ytVideoId=${ytVideoId}`)
    return { ytVideoId, ytUrl: `https://www.youtube.com/watch?v=${ytVideoId}` }
  },
})
