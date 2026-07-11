import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { db } from '@/lib/db'
import { organizations, organizationMembers, youtubeChannels, videos } from '@/lib/db/schema'
import { isNull, count, eq, ilike, sql } from 'drizzle-orm'
import { startOfMonth } from 'date-fns'
import { redis } from '@/lib/cache/redis'

export async function GET(req: NextRequest) {
  const err = await requireAdmin()
  if (err) return err

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') ?? ''
  const plan = searchParams.get('plan') ?? ''
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = 20
  const offset = (page - 1) * limit
  const monthStart = startOfMonth(new Date())

  const where = [
    search ? ilike(organizations.name, `%${search}%`) : undefined,
    plan ? eq(organizations.plan, plan as 'free' | 'starter' | 'pro' | 'agency' | 'enterprise') : undefined,
  ].filter(Boolean)

  const whereClause = where.length > 0
    ? sql`${where.reduce((a, b) => sql`${a} AND ${b}`)}`
    : undefined

  const [rows, totalRows] = await Promise.all([
    db.select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      clerkOrgId: organizations.clerkOrgId,
      plan: organizations.plan,
      maxChannels: organizations.maxChannels,
      maxTeamMembers: organizations.maxTeamMembers,
      monthlyVideoQuota: organizations.monthlyVideoQuota,
      stripeCustomerId: organizations.stripeCustomerId,
      stripeSubscriptionId: organizations.stripeSubscriptionId,
      createdAt: organizations.createdAt,
    })
      .from(organizations)
      .where(whereClause)
      .orderBy(sql`${organizations.createdAt} desc`)
      .limit(limit)
      .offset(offset),

    db.select({ total: count() }).from(organizations).where(whereClause),
  ] as const)

  // Enrich with member/channel/video counts and suspension status in parallel
  const enriched = await Promise.all(
    rows.map(async (org) => {
      const [memberRes, channelRes, videoRes, suspended] = await Promise.all([
        db.select({ count: count() })
          .from(organizationMembers)
          .where(eq(organizationMembers.organizationId, org.id)),
        db.select({ count: count() })
          .from(youtubeChannels)
          .where(sql`${eq(youtubeChannels.organizationId, org.id)} AND ${isNull(youtubeChannels.deletedAt)}`),
        db.select({ count: count() })
          .from(videos)
          .where(sql`${eq(videos.organizationId, org.id)} AND ${sql`created_at >= ${monthStart}`}`),
        redis.get(`admin:suspended:${org.id}`),
      ])
      return {
        ...org,
        memberCount: memberRes[0]?.count ?? 0,
        channelCount: channelRes[0]?.count ?? 0,
        videosThisMonth: videoRes[0]?.count ?? 0,
        suspended: !!suspended,
      }
    }),
  )

  return NextResponse.json({ orgs: enriched, total: totalRows[0]?.total ?? 0, page, limit })
}
