import { db } from '@/lib/db'
import { organizations, youtubeChannels, organizationMembers } from '@/lib/db/schema'
import { eq, and, isNull, count } from 'drizzle-orm'
import { NextResponse } from 'next/server'

interface OrgLimits {
  maxChannels: number
  maxTeamMembers: number
  monthlyVideoQuota: number
  plan: string
}

export async function getOrgLimits(orgDbId: string): Promise<OrgLimits | null> {
  const [org] = await db
    .select({
      maxChannels: organizations.maxChannels,
      maxTeamMembers: organizations.maxTeamMembers,
      monthlyVideoQuota: organizations.monthlyVideoQuota,
      plan: organizations.plan,
    })
    .from(organizations)
    .where(eq(organizations.id, orgDbId))
    .limit(1)

  return org ?? null
}

export async function enforceChannelLimit(orgDbId: string): Promise<NextResponse | null> {
  const limits = await getOrgLimits(orgDbId)
  if (!limits) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const [result] = await db
    .select({ count: count() })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.organizationId, orgDbId), isNull(youtubeChannels.deletedAt)))

  const channelCount = result?.count ?? 0

  if (channelCount >= limits.maxChannels) {
    return NextResponse.json(
      {
        error: `Channel limit reached. Your ${limits.plan} plan allows ${limits.maxChannels} channel${limits.maxChannels === 1 ? '' : 's'}. Upgrade to add more.`,
        code: 'CHANNEL_LIMIT_EXCEEDED',
        limit: limits.maxChannels,
        current: channelCount,
      },
      { status: 403 },
    )
  }

  return null
}

export async function enforceTeamMemberLimit(orgDbId: string): Promise<NextResponse | null> {
  const limits = await getOrgLimits(orgDbId)
  if (!limits) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const [result] = await db
    .select({ count: count() })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, orgDbId))

  const memberCount = result?.count ?? 0

  if (memberCount >= limits.maxTeamMembers) {
    return NextResponse.json(
      {
        error: `Team member limit reached. Your ${limits.plan} plan allows ${limits.maxTeamMembers} member${limits.maxTeamMembers === 1 ? '' : 's'}. Upgrade to add more.`,
        code: 'MEMBER_LIMIT_EXCEEDED',
        limit: limits.maxTeamMembers,
        current: memberCount,
      },
      { status: 403 },
    )
  }

  return null
}
