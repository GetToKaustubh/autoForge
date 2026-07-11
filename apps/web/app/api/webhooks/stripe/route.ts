import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { stripe, PLANS, type PlanKey } from '@/lib/services/stripe'
import { db } from '@/lib/db'
import { organizations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'

export async function POST(request: NextRequest) {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const body = await request.text()
  const sig = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const orgId = session.metadata?.orgId
        const plan = session.metadata?.plan as PlanKey | undefined
        const customerId = typeof session.customer === 'string' ? session.customer : null
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null

        if (!orgId || !plan || !PLANS[plan]) break

        const limits = PLANS[plan]
        await db
          .update(organizations)
          .set({
            plan,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            maxChannels: limits.maxChannels,
            maxTeamMembers: limits.maxTeamMembers,
            monthlyVideoQuota: limits.monthlyVideoQuota,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId))
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const orgId = sub.metadata?.orgId
        const plan = sub.metadata?.plan as PlanKey | undefined

        if (!orgId || !plan || !PLANS[plan]) break

        const isActive = sub.status === 'active' || sub.status === 'trialing'
        const limits = PLANS[isActive ? plan : 'free']

        await db
          .update(organizations)
          .set({
            plan: isActive ? plan : 'free',
            maxChannels: limits.maxChannels,
            maxTeamMembers: limits.maxTeamMembers,
            monthlyVideoQuota: limits.monthlyVideoQuota,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId))
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const orgId = sub.metadata?.orgId
        if (!orgId) break

        const freeLimits = PLANS.free
        await db
          .update(organizations)
          .set({
            plan: 'free',
            stripeSubscriptionId: null,
            maxChannels: freeLimits.maxChannels,
            maxTeamMembers: freeLimits.maxTeamMembers,
            monthlyVideoQuota: freeLimits.monthlyVideoQuota,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId))
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Stripe webhook error:', err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
