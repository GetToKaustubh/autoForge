'use client'

import { useState } from 'react'
import { useOrganization, useUser } from '@clerk/nextjs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Building2, User, Globe } from 'lucide-react'

export default function SettingsPage() {
  const { organization } = useOrganization()
  const { user } = useUser()
  const [saving, setSaving] = useState(false)

  const updateOrgName = async (name: string) => {
    if (!organization || !name.trim()) return
    setSaving(true)
    try {
      await organization.update({ name })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage organization and account settings</p>
      </div>

      {/* Organization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Organization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Organization Name</Label>
            <div className="flex gap-2">
              <Input
                key={organization?.name}
                defaultValue={organization?.name ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== organization?.name) {
                    void updateOrgName(e.target.value)
                  }
                }}
                placeholder="My Organization"
              />
              {saving && <span className="text-xs text-muted-foreground self-center">Saving…</span>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Organization ID</Label>
            <p className="text-sm text-muted-foreground font-mono bg-muted px-3 py-2 rounded-md truncate">
              {organization?.id ?? '—'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {user?.imageUrl && (
              <img src={user.imageUrl} alt="" className="h-12 w-12 rounded-full" />
            )}
            <div>
              <p className="font-medium">{user?.fullName ?? '—'}</p>
              <p className="text-sm text-muted-foreground">{user?.primaryEmailAddress?.emailAddress ?? '—'}</p>
            </div>
          </div>
          <Separator />
          <p className="text-sm text-muted-foreground">
            Manage your personal account details, password, and connected accounts via the{' '}
            <button
              className="underline underline-offset-2 text-foreground"
              onClick={() => (user as unknown as { openUserProfile?: () => void })?.openUserProfile?.()}
            >
              account settings
            </button>.
          </p>
        </CardContent>
      </Card>

      {/* App Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">App</span>
            <span className="font-medium">TubeForge</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Environment</span>
            <Badge variant="outline" className="text-xs">{process.env.NODE_ENV}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Region</span>
            <span>Mumbai (bom1)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
