'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useOrganization } from '@clerk/nextjs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Users, Mail, Clock, CheckCircle, Loader2, Send } from 'lucide-react'

type InviteRole = 'admin' | 'editor' | 'viewer'

interface TeamInvite {
  id: string
  email: string
  role: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800',
  admin: 'bg-blue-100 text-blue-800',
  editor: 'bg-green-100 text-green-800',
  viewer: 'bg-gray-100 text-gray-700',
}

export default function TeamPage() {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('editor')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const queryClient = useQueryClient()
  const { organization, memberships } = useOrganization({ memberships: { infinite: false } })

  const { data: invitesData, isLoading: invitesLoading } = useQuery({
    queryKey: ['team-invites'],
    queryFn: async () => {
      const res = await fetch('/api/team/invite')
      if (!res.ok) return { invites: [] }
      return res.json() as Promise<{ invites: TeamInvite[] }>
    },
  })

  const { mutate: sendInvite, isPending: isSending } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to send invite')
      }
      return res.json() as Promise<{ email: string }>
    },
    onSuccess: (data) => {
      setInviteSuccess(data.email)
      setEmail('')
      void queryClient.invalidateQueries({ queryKey: ['team-invites'] })
      setTimeout(() => setInviteSuccess(''), 5000)
    },
  })

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    if (email.trim()) sendInvite()
  }

  const members = memberships?.data ?? []
  const invites = invitesData?.invites ?? []
  const pendingInvites = invites.filter((i) => !i.acceptedAt && new Date(i.expiresAt) > new Date())

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-muted-foreground mt-1">
          Manage your team members and invite collaborators to {organization?.name ?? 'your workspace'}.
        </p>
      </div>

      {/* Invite Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite Team Member</CardTitle>
          <CardDescription>Send an invitation email. Links expire in 7 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex gap-3">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="pl-9"
                disabled={isSending}
              />
            </div>
            <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!email.trim() || isSending}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" />Invite</>}
            </Button>
          </form>
          {inviteSuccess && (
            <div className="mt-3 flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
              <CheckCircle className="h-4 w-4" />
              Invitation sent to {inviteSuccess}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Members ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading members...</p>
          ) : (
            <div className="space-y-3">
              {members.map((m) => {
                const member = m.publicUserData
                const name = `${member?.firstName ?? ''} ${member?.lastName ?? ''}`.trim() || member?.identifier
                const initials = name?.split(' ').map((n) => n[0]).join('').toUpperCase() ?? '?'
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member?.imageUrl} />
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground truncate">{member?.identifier}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[m.role] ?? 'bg-gray-100 text-gray-700'}`}>
                      {m.role}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {(invitesLoading || pendingInvites.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending Invites
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {invitesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-3">
                {pendingInvites.map((invite) => (
                  <div key={invite.id} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{invite.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Expires {new Date(invite.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[invite.role] ?? 'bg-gray-100 text-gray-700'}`}>
                      {invite.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Role Descriptions */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Role Permissions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <div>
              <p className="font-semibold mb-1">Admin</p>
              <p className="text-muted-foreground">Can manage channels, approve scripts, invite team members, and view billing.</p>
            </div>
            <div>
              <p className="font-semibold mb-1">Editor</p>
              <p className="text-muted-foreground">Can create and edit ideas, scripts, and schedules. Cannot approve or manage team.</p>
            </div>
            <div>
              <p className="font-semibold mb-1">Viewer</p>
              <p className="text-muted-foreground">Read-only access to all content. Cannot create or modify anything.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
