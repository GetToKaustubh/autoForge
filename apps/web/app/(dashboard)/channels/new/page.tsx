import { Youtube, Shield, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Connect Channel' }

const SCOPES_INFO = [
  { label: 'Read channel info and statistics', icon: CheckCircle },
  { label: 'Upload and manage videos', icon: CheckCircle },
  { label: 'Read Analytics (views, watch time, CTR)', icon: CheckCircle },
  { label: 'Read Revenue data (RPM, CPM)', icon: CheckCircle },
]

export default function ConnectChannelPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connect YouTube Channel</h1>
        <p className="text-muted-foreground">
          Authorize TubeForge to manage your YouTube channel.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-youtube-red" />
            YouTube Authorization
          </CardTitle>
          <CardDescription>
            We request the following permissions to automate your channel:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {SCOPES_INFO.map((scope) => (
              <li key={scope.label} className="flex items-center gap-2 text-sm">
                <scope.icon className="h-4 w-4 text-green-500 shrink-0" />
                {scope.label}
              </li>
            ))}
          </ul>

          <div className="rounded-md bg-muted p-3 flex items-start gap-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Your OAuth tokens are encrypted with AES-256-GCM before storage. We never store your
              Google account password. You can revoke access at any time from Google's security settings.
            </p>
          </div>

          <Button asChild className="w-full" size="lg">
            <a href="/api/auth/youtube/connect">
              <Youtube className="mr-2 h-5 w-5" />
              Connect with Google
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
