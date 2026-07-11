'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Search, ChevronRight, AlertCircle } from 'lucide-react'

interface Org {
  id: string
  name: string
  slug: string
  plan: string
  maxChannels: number
  maxTeamMembers: number
  monthlyVideoQuota: number
  createdAt: string
  memberCount: number
  channelCount: number
  videosThisMonth: number
  suspended: boolean
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700 border-gray-200',
  starter: 'bg-blue-100 text-blue-800 border-blue-200',
  pro: 'bg-purple-100 text-purple-800 border-purple-200',
  agency: 'bg-amber-100 text-amber-800 border-amber-200',
  enterprise: 'bg-green-100 text-green-800 border-green-200',
}

export default function AdminOrgsPage() {
  const [search, setSearch] = useState('')
  const [plan, setPlan] = useState('all')
  const [page, setPage] = useState(1)

  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (plan !== 'all') params.set('plan', plan)
  params.set('page', String(page))

  const { data, isLoading } = useQuery<{ orgs: Org[]; total: number; limit: number }>({
    queryKey: ['admin', 'orgs', search, plan, page],
    queryFn: async () => {
      const res = await fetch(`/api/admin/organizations?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const totalPages = Math.ceil((data?.total ?? 0) / (data?.limit ?? 20))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Organizations</h1>
        <p className="text-muted-foreground text-sm">{data?.total ?? '—'} total</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <Select value={plan} onValueChange={(v) => { setPlan(v); setPage(1) }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All plans" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="agency">Agency</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">Organization</th>
                <th className="text-left px-4 py-3 font-medium">Plan</th>
                <th className="text-right px-4 py-3 font-medium">Members</th>
                <th className="text-right px-4 py-3 font-medium">Channels</th>
                <th className="text-right px-4 py-3 font-medium">Videos/mo</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : (data?.orgs ?? []).map((org) => (
                    <tr key={org.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {org.suspended && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                          <div>
                            <p className="font-medium">{org.name}</p>
                            <p className="text-xs text-muted-foreground">{org.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${PLAN_COLOR[org.plan] ?? 'bg-muted'}`}>
                          {org.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {org.memberCount}/{org.maxTeamMembers}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {org.channelCount}/{org.maxChannels}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {org.videosThisMonth}/{org.monthlyVideoQuota}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(org.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/organizations/${org.id}`}>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
