import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { organizations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'
import { createPortalSession } from '@/lib/services/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!

export async function POST() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member || !canAdmin(member.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [org] = await db
    .select({ stripeCustomerId: organizations.stripeCustomerId })
    .from(organizations)
    .where(eq(organizations.id, member.orgDbId))
    .limit(1)

  if (!org?.stripeCustomerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  try {
    const session = await createPortalSession({
      stripeCustomerId: org.stripeCustomerId,
      returnUrl: `${APP_URL}/settings/billing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Portal failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
