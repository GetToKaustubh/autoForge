import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getOrgMember } from '@/lib/auth/get-member'
import { PLANS } from '@/lib/services/stripe'

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
      stripeCustomerId: organizations.stripeCustomerId,
      stripeSubscriptionId: organizations.stripeSubscriptionId,
    })
    .from(organizations)
    .where(eq(organizations.id, member.orgDbId))
    .limit(1)

  const plans = Object.entries(PLANS).map(([key, p]) => ({
    key,
    name: p.name,
    price: p.price,
    maxChannels: p.maxChannels,
    maxTeamMembers: p.maxTeamMembers,
    monthlyVideoQuota: p.monthlyVideoQuota,
    available: p.priceId !== null || key === 'free',
  }))

  return NextResponse.json({
    current: org,
    plans,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
  })
}
