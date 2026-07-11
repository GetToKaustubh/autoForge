import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV === 'production') {
  console.warn('STRIPE_SECRET_KEY not set — billing disabled')
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' })
  : null

export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    maxChannels: 1,
    maxTeamMembers: 1,
    monthlyVideoQuota: 4,
    priceId: null,
  },
  starter: {
    name: 'Starter',
    price: 99,
    maxChannels: 3,
    maxTeamMembers: 3,
    monthlyVideoQuota: 30,
    priceId: process.env.STRIPE_PRICE_STARTER ?? null,
  },
  pro: {
    name: 'Pro',
    price: 299,
    maxChannels: 10,
    maxTeamMembers: 10,
    monthlyVideoQuota: 100,
    priceId: process.env.STRIPE_PRICE_PRO ?? null,
  },
  agency: {
    name: 'Agency',
    price: 999,
    maxChannels: 50,
    maxTeamMembers: 50,
    monthlyVideoQuota: 500,
    priceId: process.env.STRIPE_PRICE_AGENCY ?? null,
  },
} as const

export type PlanKey = keyof typeof PLANS

export function getPlanLimits(plan: PlanKey) {
  return PLANS[plan] ?? PLANS.free
}

export async function createCheckoutSession({
  orgId,
  clerkOrgId,
  plan,
  successUrl,
  cancelUrl,
  stripeCustomerId,
}: {
  orgId: string
  clerkOrgId: string
  plan: PlanKey
  successUrl: string
  cancelUrl: string
  stripeCustomerId?: string | null
}) {
  if (!stripe) throw new Error('Stripe not configured')

  const planConfig = PLANS[plan]
  if (!planConfig.priceId) throw new Error(`No price ID configured for plan: ${plan}`)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    customer: stripeCustomerId ?? undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { orgId, clerkOrgId, plan },
    subscription_data: { metadata: { orgId, clerkOrgId, plan } },
  })

  return session
}

export async function createPortalSession({
  stripeCustomerId,
  returnUrl,
}: {
  stripeCustomerId: string
  returnUrl: string
}) {
  if (!stripe) throw new Error('Stripe not configured')

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  })

  return session
}
