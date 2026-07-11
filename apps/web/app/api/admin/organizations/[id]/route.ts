import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { db } from '@/lib/db'
import { organizations, organizationMembers, youtubeChannels, users, auditLogs, apiUsage } from '@/lib/db/schema'
import { eq, isNull, count, sum, desc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { redis } from '@/lib/cache/redis'
import { startOfMonth } from 'date-fns'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await requireAdmin()
  if (err) return err

  const { id } = await params

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const monthStart = startOfMonth(new Date())

  const [members, channels, [apiCost], recentLogs, suspended] = await Promise.all([
    db
      .select({
        id: organizationMembers.id,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, id)),

    db
      .select({
        id: youtubeChannels.id,
        channelName: youtubeChannels.channelName,
        channelHandle: youtubeChannels.channelHandle,
        channelThumbnail: youtubeChannels.channelThumbnail,
        subscriberCount: youtubeChannels.subscriberCount,
        status: youtubeChannels.status,
        quotaUsedToday: youtubeChannels.quotaUsedToday,
        quotaLimitDaily: youtubeChannels.quotaLimitDaily,
        createdAt: youtubeChannels.createdAt,
      })
      .from(youtubeChannels)
      .where(sql`${eq(youtubeChannels.organizationId, id)} AND ${isNull(youtubeChannels.deletedAt)}`),

    db
      .select({ total: sum(apiUsage.costUsd) })
      .from(apiUsage)
      .where(sql`${eq(apiUsage.organizationId, id)} AND ${sql`recorded_at >= ${monthStart}`}`),

    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        createdAt: auditLogs.createdAt,
        userEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(eq(auditLogs.organizationId, id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(20),

    redis.get(`admin:suspended:${id}`),
  ])

  return NextResponse.json({
    org,
    members,
    channels,
    apiCostThisMonth: Number(apiCost?.total ?? 0),
    recentLogs,
    suspended: !!suspended,
  })
}

const patchSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'agency', 'enterprise']).optional(),
  maxChannels: z.number().int().positive().optional(),
  maxTeamMembers: z.number().int().positive().optional(),
  monthlyVideoQuota: z.number().int().positive().optional(),
  suspended: z.boolean().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await requireAdmin()
  if (err) return err

  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { suspended, ...dbFields } = parsed.data

  // Update DB fields (plan, limits)
  if (Object.keys(dbFields).length > 0) {
    await db
      .update(organizations)
      .set({ ...dbFields, updatedAt: new Date() })
      .where(eq(organizations.id, id))
  }

  // Update suspension in Redis
  if (suspended !== undefined) {
    if (suspended) {
      await redis.set(`admin:suspended:${id}`, '1')
    } else {
      await redis.del(`admin:suspended:${id}`)
    }
  }

  const [updated] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1)

  return NextResponse.json({
    org: updated,
    suspended: !!await redis.get(`admin:suspended:${id}`),
  })
}
