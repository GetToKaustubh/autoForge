'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, Zap, Crown, Building2, ExternalLink, AlertCircle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

interface Plan {
  key: string
  name: string
  price: number
  maxChannels: number
  maxTeamMembers: number
  monthlyVideoQuota: number
  available: boolean
}

interface BillingData {
  current: { plan: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null }
  plans: Plan[]
  stripeConfigured: boolean
}

interface UsageData {
  plan: string
  usage: {
    channels: { used: number; limit: number }
    teamMembers: { used: number; limit: number }
    videosThisMonth: { used: number; limit: number }
  }
}

const PLAN_ICON = {
  free: Zap,
  starter: Zap,
  pro: Crown,
  agency: Building2,
}

const PLAN_COLOR = {
  free: 'bg-gray-100 text-gray-700',
  starter: 'bg-blue-100 text-blue-800',
  pro: 'bg-purple-100 text-purple-800',
  agency: 'bg-amber-100 text-amber-800',
}

function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min((used / Math.max(limit, 1)) * 100, 100)
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-primary'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{used} / {limit}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BillingContent() {
  const searchParams = useSearchParams()
  const success = searchParams.get('success')
  const cancelled = searchParams.get('cancelled')

  const { data, isLoading } = useQuery<BillingData>({
    queryKey: ['billing', 'plans'],
    queryFn: async () => {
      const res = await fetch('/api/billing/plans')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: usage, isLoading: usageLoading } = useQuery<UsageData>({
    queryKey: ['billing', 'usage'],
    queryFn: async () => {
      const res = await fetch('/api/billing/usage')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { mutate: checkout, isPending: checkingOut, variables: checkoutPlan } = useMutation({
    mutationFn: async (plan: string) => {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const json = await res.json() as { url?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      if (json.url) window.location.href = json.url
    },
  })

  const { mutate: openPortal, isPending: portalLoading } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const json = await res.json() as { url?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      if (json.url) window.location.href = json.url
    },
  })

  const currentPlan = data?.current?.plan ?? 'free'
  const PlanIcon = PLAN_ICON[currentPlan as keyof typeof PLAN_ICON] ?? Zap

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">Manage your subscription and usage</p>
      </div>

      {success && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Subscription activated successfully!
        </div>
      )}
      {cancelled && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Checkout cancelled. Your plan was not changed.
        </div>
      )}
      {!data?.stripeConfigured && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Stripe not configured. Add STRIPE_SECRET_KEY and STRIPE_PRICE_* env vars to enable billing.
        </div>
      )}

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlanIcon className="h-4 w-4" />
            Current Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? <Skeleton className="h-8 w-32" /> : (
            <div className="flex items-center justify-between">
              <span className={`text-lg font-bold px-3 py-1 rounded-lg capitalize ${PLAN_COLOR[currentPlan as keyof typeof PLAN_COLOR] ?? ''}`}>
                {currentPlan}
              </span>
              {data?.current?.stripeSubscriptionId && (
                <Button variant="outline" size="sm" onClick={() => openPortal()} disabled={portalLoading}>
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />
                  {portalLoading ? 'Opening…' : 'Manage Subscription'}
                </Button>
              )}
            </div>
          )}

          {/* Usage bars */}
          {usageLoading ? (
            <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : usage && (
            <div className="space-y-3 pt-2">
              <UsageBar label="YouTube Channels" used={usage.usage.channels.used} limit={usage.usage.channels.limit} />
              <UsageBar label="Team Members" used={usage.usage.teamMembers.used} limit={usage.usage.teamMembers.limit} />
              <UsageBar label="Videos This Month" used={usage.usage.videosThisMonth.used} limit={usage.usage.videosThisMonth.limit} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? [1,2,3].map((i) => <Skeleton key={i} className="h-64" />)
          : (data?.plans ?? []).filter((p) => p.key !== 'free').map((plan) => {
              const isCurrent = plan.key === currentPlan
              const PlanIcon2 = PLAN_ICON[plan.key as keyof typeof PLAN_ICON] ?? Zap
              return (
                <Card key={plan.key} className={isCurrent ? 'border-primary shadow-sm' : ''}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-1.5">
                        <PlanIcon2 className="h-4 w-4" />
                        {plan.name}
                      </CardTitle>
                      {isCurrent && <Badge variant="default" className="text-xs">Current</Badge>}
                    </div>
                    <p className="text-2xl font-bold">${plan.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />{plan.maxChannels} YouTube channels</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />{plan.maxTeamMembers} team members</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />{plan.monthlyVideoQuota} videos/month</div>
                    <Button
                      className="w-full mt-3"
                      variant={isCurrent ? 'outline' : 'default'}
                      disabled={isCurrent || !plan.available || !data?.stripeConfigured || checkingOut}
                      onClick={() => checkout(plan.key)}
                    >
                      {checkingOut && checkoutPlan === plan.key ? 'Redirecting…' :
                        isCurrent ? 'Current Plan' :
                        !plan.available ? 'Contact Sales' : 'Upgrade'}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
      </div>
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="space-y-4">{[1,2,3].map((i) => <Skeleton key={i} className="h-32" />)}</div>}>
      <BillingContent />
    </Suspense>
  )
}
