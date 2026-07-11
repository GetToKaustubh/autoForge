'use client'

import { use, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { AlertCircle, CheckCircle2, ChevronLeft, Shield, ShieldOff, Youtube } from 'lucide-react'
import Link from 'next/link'

interface OrgDetail {
  org: {
    id: string; name: string; slug: string; plan: string
    maxChannels: number; maxTeamMembers: number; monthlyVideoQuota: number
    stripeCustomerId: string | null; stripeSubscriptionId: string | null
    createdAt: string
  }
  members: { id: string; role: string; email: string; fullName: string | null; avatarUrl: string | null; joinedAt: string }[]
  channels: { id: string; channelName: string; channelHandle: string | null; channelThumbnail: string | null; subscriberCount: number | null; status: string; quotaUsedToday: number; quotaLimitDaily: number }[]
  apiCostThisMonth: number
  recentLogs: { id: string; action: string; resourceType: string | null; createdAt: string; userEmail: string | null }[]
  suspended: boolean
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700', starter: 'bg-blue-100 text-blue-800',
  pro: 'bg-purple-100 text-purple-800', agency: 'bg-amber-100 text-amber-800',
  enterprise: 'bg-green-100 text-green-800',
}
const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800', admin: 'bg-blue-100 text-blue-800',
  editor: 'bg-green-100 text-green-800', viewer: 'bg-gray-100 text-gray-700',
}

export default function AdminOrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const qc = useQueryClient()

  const [editPlan, setEditPlan] = useState('')
  const [editMaxChannels, setEditMaxChannels] = useState('')
  const [editMaxMembers, setEditMaxMembers] = useState('')
  const [editVideoQuota, setEditVideoQuota] = useState('')

  const { data, isLoading } = useQuery<OrgDetail>({
    queryKey: ['admin', 'org', id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/organizations/${id}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
  })

  const { mutate: patch, isPending: patching } = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'org', id] }),
  })

  const applyOverride = () => {
    const body: Record<string, unknown> = {}
    if (editPlan) body.plan = editPlan
    if (editMaxChannels) body.maxChannels = Number(editMaxChannels)
    if (editMaxMembers) body.maxTeamMembers = Number(editMaxMembers)
    if (editVideoQuota) body.monthlyVideoQuota = Number(editVideoQuota)
    if (Object.keys(body).length > 0) patch(body)
  }

  const org = data?.org

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/organizations">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          {isLoading ? <Skeleton className="h-7 w-48" /> : (
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold truncate">{org?.name}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${PLAN_COLOR[org?.plan ?? ''] ?? 'bg-muted'}`}>
                {org?.plan}
              </span>
              {data?.suspended && (
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-800 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />Suspended
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            Created {org ? new Date(org.createdAt).toLocaleDateString() : '—'} · ID: {id}
          </p>
        </div>
        {/* Suspend / Unsuspend */}
        <Button
          variant={data?.suspended ? 'outline' : 'destructive'}
          size="sm"
          disabled={patching || isLoading}
          onClick={() => patch({ suspended: !data?.suspended })}
        >
          {data?.suspended
            ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Unsuspend</>
            : <><ShieldOff className="h-3.5 w-3.5 mr-1.5" />Suspend Org</>
          }
        </Button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Plan & Limits Override */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Plan Override
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm pb-3 border-b">
              <div><p className="text-muted-foreground">Plan</p><p className="font-medium capitalize">{org?.plan ?? '—'}</p></div>
              <div><p className="text-muted-foreground">Channels</p><p className="font-medium">{org?.maxChannels ?? '—'}</p></div>
              <div><p className="text-muted-foreground">Members</p><p className="font-medium">{org?.maxTeamMembers ?? '—'}</p></div>
              <div><p className="text-muted-foreground">Video Quota</p><p className="font-medium">{org?.monthlyVideoQuota ?? '—'}/mo</p></div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Plan</Label>
                <Select value={editPlan} onValueChange={setEditPlan}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={`Current: ${org?.plan ?? '…'}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {['free','starter','pro','agency','enterprise'].map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Channels</Label>
                  <Input className="h-8 text-xs" placeholder={String(org?.maxChannels ?? '')} value={editMaxChannels} onChange={(e) => setEditMaxChannels(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Members</Label>
                  <Input className="h-8 text-xs" placeholder={String(org?.maxTeamMembers ?? '')} value={editMaxMembers} onChange={(e) => setEditMaxMembers(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Video Quota</Label>
                  <Input className="h-8 text-xs" placeholder={String(org?.monthlyVideoQuota ?? '')} value={editVideoQuota} onChange={(e) => setEditVideoQuota(e.target.value)} />
                </div>
              </div>
              <Button size="sm" className="w-full" disabled={patching} onClick={applyOverride}>
                {patching ? 'Saving…' : 'Apply Override'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              API Cost This Month: <strong>${data?.apiCostThisMonth.toFixed(4) ?? '—'}</strong>
            </p>
          </CardContent>
        </Card>

        {/* Members */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members ({data?.members.length ?? '—'})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)
              : (data?.members ?? []).map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{m.fullName ?? m.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.fullName ? m.email : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded capitalize shrink-0 ml-2 ${ROLE_COLOR[m.role] ?? 'bg-muted'}`}>
                      {m.role}
                    </span>
                  </div>
                ))}
          </CardContent>
        </Card>
      </div>

      {/* YouTube Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Youtube className="h-4 w-4" />
            YouTube Channels ({data?.channels.length ?? '—'})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading
            ? <Skeleton className="h-20" />
            : (data?.channels ?? []).length === 0
              ? <p className="text-sm text-muted-foreground">No channels connected</p>
              : (
                  <div className="space-y-2">
                    {(data?.channels ?? []).map((ch) => {
                      const pct = Math.min((ch.quotaUsedToday / Math.max(ch.quotaLimitDaily, 1)) * 100, 100)
                      const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-primary'
                      return (
                        <div key={ch.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                          {ch.channelThumbnail && (
                            <img src={ch.channelThumbnail} alt="" className="h-8 w-8 rounded-full shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{ch.channelName}</p>
                              <span className={`text-xs capitalize ${ch.status === 'active' ? 'text-green-600' : 'text-yellow-600'}`}>
                                {ch.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                                <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                {ch.quotaUsedToday}/{ch.quotaLimitDaily}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground shrink-0">
                            {(ch.subscriberCount ?? 0).toLocaleString()} subs
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
        </CardContent>
      </Card>

      {/* Audit Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading
            ? <Skeleton className="h-32" />
            : (data?.recentLogs ?? []).length === 0
              ? <p className="text-sm text-muted-foreground">No audit logs</p>
              : (
                  <div className="space-y-1">
                    {(data?.recentLogs ?? []).map((log) => (
                      <div key={log.id} className="flex items-start justify-between py-1.5 border-b last:border-0 text-sm gap-3">
                        <div className="min-w-0">
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{log.action}</span>
                          {log.userEmail && (
                            <span className="text-xs text-muted-foreground ml-2">{log.userEmail}</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
        </CardContent>
      </Card>
    </div>
  )
}
