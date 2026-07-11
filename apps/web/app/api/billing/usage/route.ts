import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations, youtubeChannels, videos, organizationMembers } from '@/lib/db/schema'
import { and, eq, isNull, gte, count } from 'drizzle-orm'
import { getOrgMember } from '@/lib/auth/get-member'
import { startOfMonth } from 'date-fns'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [org] = await db
    .select({
      plan: organizations.plan,
      maxChannels: organizations.maxChannels,
      maxTeamMembers: organizations.maxTeamMembers,
      monthlyVideoQuota: organizations.monthlyVideoQuota,
    })
    .from(organizations)
    .where(eq(organizations.id, member.orgDbId))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [channelCount] = await db
    .select({ count: count() })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.organizationId, member.orgDbId), isNull(youtubeChannels.deletedAt)))

  const [memberCount] = await db
    .select({ count: count() })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, member.orgDbId))

  const monthStart = startOfMonth(new Date())
  const [videoCount] = await db
    .select({ count: count() })
    .from(videos)
    .where(and(eq(videos.organizationId, member.orgDbId), gte(videos.createdAt, monthStart)))

  return NextResponse.json({
    plan: org.plan,
    usage: {
      channels: { used: channelCount?.count ?? 0, limit: org.maxChannels },
      teamMembers: { used: memberCount?.count ?? 0, limit: org.maxTeamMembers },
      videosThisMonth: { used: videoCount?.count ?? 0, limit: org.monthlyVideoQuota },
    },
  })
}
