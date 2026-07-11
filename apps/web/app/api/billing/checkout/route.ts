import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'
import { createCheckoutSession, type PlanKey } from '@/lib/services/stripe'
import { z } from 'zod'

const Schema = z.object({
  plan: z.enum(['starter', 'pro', 'agency']),
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

export async function POST(request: Request) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member || !canAdmin(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as unknown
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const [org] = await db
    .select({ id: organizations.id, clerkOrgId: organizations.clerkOrgId, stripeCustomerId: organizations.stripeCustomerId })
    .from(organizations)
    .where(eq(organizations.id, member.orgDbId))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  try {
    const session = await createCheckoutSession({
      orgId: org.id,
      clerkOrgId: org.clerkOrgId,
      plan: parsed.data.plan as PlanKey,
      successUrl: `${APP_URL}/settings/billing?success=1`,
      cancelUrl: `${APP_URL}/settings/billing?cancelled=1`,
      stripeCustomerId: org.stripeCustomerId,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
