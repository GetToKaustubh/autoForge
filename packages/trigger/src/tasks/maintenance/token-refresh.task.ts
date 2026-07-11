import { task, logger } from '@trigger.dev/sdk/v3'
import { db } from '../../lib/db'
import { youtubeChannels } from '../../lib/db/schema'
import { eq, and, lt, isNull } from 'drizzle-orm'
import { refreshChannelToken } from '../../lib/auth/youtube-oauth'

// Cron: every 30 minutes — proactively refreshes tokens expiring within 1 hour
export const tokenRefreshTask = task({
  id: 'token-refresh',
  maxDuration: 120,

  run: async () => {
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000)

    const expiringChannels = await db
      .select({
        id: youtubeChannels.id,
        ytChannelId: youtubeChannels.ytChannelId,
        tokenExpiresAt: youtubeChannels.tokenExpiresAt,
      })
      .from(youtubeChannels)
      .where(
        and(
          lt(youtubeChannels.tokenExpiresAt, oneHourFromNow),
          eq(youtubeChannels.status, 'active'),
          isNull(youtubeChannels.deletedAt)
        )
      )

    logger.info(`Token refresh: ${expiringChannels.length} channels to refresh`)

    const results = await Promise.allSettled(
      expiringChannels.map(async (channel) => {
        try {
          await refreshChannelToken(channel.id)
          logger.info(`Token refreshed for channel ${channel.id}`)
          return { channelId: channel.id, success: true }
        } catch (error) {
          logger.error(`Token refresh failed for channel ${channel.id}: ${String(error)}`)
          await db
            .update(youtubeChannels)
            .set({ status: 'disconnected', updatedAt: new Date() })
            .where(eq(youtubeChannels.id, channel.id))
          return { channelId: channel.id, success: false, error: String(error) }
        }
      })
    )

    const succeeded = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as { success: boolean }).success
    ).length
    const failed = results.length - succeeded

    logger.info(`Token refresh complete: ${succeeded} succeeded, ${failed} failed`)
    return { total: results.length, succeeded, failed }
  },
})
