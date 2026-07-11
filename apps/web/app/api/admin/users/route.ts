import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { db } from '@/lib/db'
import { users, organizationMembers, organizations } from '@/lib/db/schema'
import { eq, count, ilike, sql, desc } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const err = await requireAdmin()
  if (err) return err

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = 25
  const offset = (page - 1) * limit

  const where = search ? ilike(users.email, `%${search}%`) : undefined

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: users.id,
        clerkId: users.clerkId,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        onboardingDone: users.onboardingDone,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),

    db.select({ total: count() }).from(users).where(where),
  ] as const)

  // Attach org membership info
  const enriched = await Promise.all(
    rows.map(async (user) => {
      const memberships = await db
        .select({
          role: organizationMembers.role,
          orgName: organizations.name,
          orgPlan: organizations.plan,
          orgId: organizations.id,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, user.id))

      return { ...user, memberships }
    }),
  )

  return NextResponse.json({ users: enriched, total: totalRows[0]?.total ?? 0, page, limit })
}
