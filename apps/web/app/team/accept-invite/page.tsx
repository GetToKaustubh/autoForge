'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle, XCircle, Loader2, Users } from 'lucide-react'

interface InviteDetails {
  id: string
  email: string
  role: string
  expiresAt: string
  acceptedAt: string | null
}

export default function AcceptInvitePage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const { isSignedIn, isLoaded } = useAuth()
  const router = useRouter()

  const [invite, setInvite] = useState<InviteDetails | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Invalid invite link')
      setLoading(false)
      return
    }

    fetch(`/api/team/invite/${token}/accept`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json() as { error?: string }
          setError(err.error ?? 'Invite not found')
        } else {
          const data = await res.json() as InviteDetails
          setInvite(data)
          if (data.acceptedAt) setAccepted(true)
        }
      })
      .catch(() => setError('Failed to load invite'))
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async () => {
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=/team/accept-invite?token=${token}`)
      return
    }

    setAccepting(true)
    try {
      const res = await fetch(`/api/team/invite/${token}/accept`, { method: 'POST' })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to accept invite')
      } else {
        setAccepted(true)
        setTimeout(() => router.push('/'), 2000)
      }
    } catch {
      setError('Failed to accept invite')
    } finally {
      setAccepting(false)
    }
  }

  if (loading || !isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center">
            <Skeleton className="h-12 w-12 rounded-full mx-auto mb-4" />
            <Skeleton className="h-6 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            {accepted ? (
              <CheckCircle className="h-7 w-7 text-green-600" />
            ) : error ? (
              <XCircle className="h-7 w-7 text-destructive" />
            ) : (
              <Users className="h-7 w-7 text-primary" />
            )}
          </div>
          <CardTitle>
            {accepted ? 'Welcome aboard!' : error ? 'Invalid Invite' : 'Team Invitation'}
          </CardTitle>
          {invite && !accepted && !error && (
            <CardDescription>
              You've been invited to join as a <strong>{invite.role}</strong>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 p-4 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          {accepted && (
            <div className="rounded-lg bg-green-50 p-4 text-center">
              <p className="text-sm text-green-700">You've joined the team! Redirecting you to the dashboard...</p>
            </div>
          )}
          {invite && !accepted && !error && (
            <>
              <div className="rounded-lg bg-muted p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{invite.email}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Role</span>
                  <span className="font-medium capitalize">{invite.role}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expires</span>
                  <span className="font-medium">{new Date(invite.expiresAt).toLocaleDateString()}</span>
                </div>
              </div>
              {!isSignedIn && (
                <p className="text-sm text-center text-muted-foreground">
                  You'll need to sign in with <strong>{invite.email}</strong> to accept this invite.
                </p>
              )}
              <Button
                className="w-full"
                onClick={handleAccept}
                disabled={accepting}
              >
                {accepting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Accepting...</>
                ) : isSignedIn ? (
                  'Accept Invitation'
                ) : (
                  'Sign In to Accept'
                )}
              </Button>
            </>
          )}
          {error && (
            <Button variant="outline" className="w-full" onClick={() => router.push('/')}>
              Go to Dashboard
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
