'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'

interface Membership {
  role: string
  orgName: string
  orgPlan: string
  orgId: string
}

interface User {
  id: string
  email: string
  fullName: string | null
  avatarUrl: string | null
  onboardingDone: boolean
  createdAt: string
  memberships: Membership[]
}

const ROLE_COLOR: Record<string, string> = {
  owner: 'text-purple-700', admin: 'text-blue-700',
  editor: 'text-green-700', viewer: 'text-gray-500',
}
const PLAN_BADGE: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600', starter: 'bg-blue-100 text-blue-700',
  pro: 'bg-purple-100 text-purple-700', agency: 'bg-amber-100 text-amber-700',
  enterprise: 'bg-green-100 text-green-700',
}

export default function AdminUsersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const params = new URLSearchParams()
  if (search) params.set('search', search)
  params.set('page', String(page))

  const { data, isLoading } = useQuery<{ users: User[]; total: number; limit: number }>({
    queryKey: ['admin', 'users', search, page],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const totalPages = Math.ceil((data?.total ?? 0) / (data?.limit ?? 25))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-muted-foreground text-sm">{data?.total ?? '—'} registered users</p>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Organizations</th>
                <th className="text-left px-4 py-3 font-medium">Onboarded</th>
                <th className="text-left px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: 4 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : (data?.users ?? []).map((user) => (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {user.avatarUrl
                            ? <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full shrink-0" />
                            : <div className="h-7 w-7 rounded-full bg-muted shrink-0 flex items-center justify-center text-xs font-medium">{(user.email[0] ?? '?').toUpperCase()}</div>
                          }
                          <div className="min-w-0">
                            <p className="font-medium truncate">{user.fullName ?? user.email}</p>
                            {user.fullName && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {user.memberships.length === 0
                            ? <span className="text-muted-foreground text-xs">No orgs</span>
                            : user.memberships.map((m) => (
                                <span key={m.orgId} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${PLAN_BADGE[m.orgPlan] ?? 'bg-muted'}`}>
                                  <span className={`font-medium ${ROLE_COLOR[m.role] ?? ''}`}>{m.role[0]?.toUpperCase()}</span>
                                  {m.orgName}
                                </span>
                              ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${user.onboardingDone ? 'text-green-600' : 'text-muted-foreground'}`}>
                          {user.onboardingDone ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
