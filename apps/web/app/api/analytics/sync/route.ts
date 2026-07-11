import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { youtubeChannels, channelAnalytics } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { rateLimiters, applyRateLimit } from '@/lib/rate-limit'
import { getOrgMember } from '@/lib/auth/get-member'
import { getValidAccessToken } from '@/lib/auth/youtube-oauth'
import { subDays, format } from 'date-fns'

export async function POST() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await applyRateLimit(rateLimiters.api, userId)
  if (rl) return rl

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const channels = await db
    .select({ id: youtubeChannels.id, ytChannelId: youtubeChannels.ytChannelId })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.organizationId, member.orgDbId), eq(youtubeChannels.status, 'active'), isNull(youtubeChannels.deletedAt)))

  if (channels.length === 0) return NextResponse.json({ synced: 0 })

  const endDate = format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  let synced = 0
  const errors: string[] = []

  for (const channel of channels) {
    try {
      const accessToken = await getValidAccessToken(channel.id)

      const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
      url.searchParams.set('ids', `channel==${channel.ytChannelId}`)
      url.searchParams.set('startDate', startDate)
      url.searchParams.set('endDate', endDate)
      url.searchParams.set('metrics', 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,estimatedRevenue')
      url.searchParams.set('dimensions', 'day')

      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })

      if (res.ok) {
        const data = await res.json() as { rows?: Array<[string, number, number, number, number, number]> }
        if (data.rows) {
          for (const row of data.rows) {
            const [day, views, watchMin, subsGained, subsLost, revenue] = row
            if (!day) continue
            await db
              .insert(channelAnalytics)
              .values({
                organizationId: member.orgDbId,
                channelId: channel.id,
                snapshotDate: day,
                totalViews: views ?? 0,
                totalWatchTimeMin: watchMin ?? 0,
                subscriberChange: (subsGained ?? 0) - (subsLost ?? 0),
                totalRevenueUsd: (revenue ?? 0).toString(),
              })
              .onConflictDoUpdate({
                target: [channelAnalytics.channelId, channelAnalytics.snapshotDate],
                set: {
                  totalViews: views ?? 0,
                  totalWatchTimeMin: watchMin ?? 0,
                  subscriberChange: (subsGained ?? 0) - (subsLost ?? 0),
                  totalRevenueUsd: (revenue ?? 0).toString(),
                },
              })
          }
        }
        synced++
      } else {
        const errBody = await res.text()
        errors.push(`${channel.id}: ${res.status} ${errBody.slice(0, 100)}`)
      }
    } catch (err) {
      errors.push(`${channel.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({ synced, errors, total: channels.length })
}
