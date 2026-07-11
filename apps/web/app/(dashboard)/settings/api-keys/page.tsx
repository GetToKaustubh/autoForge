'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Key, ExternalLink } from 'lucide-react'

const INTEGRATIONS = [
  {
    name: 'OpenAI',
    env: 'OPENAI_API_KEY',
    desc: 'GPT-4o for script generation and niche research',
    docsUrl: 'https://platform.openai.com/api-keys',
    configured: !!process.env.NEXT_PUBLIC_HAS_OPENAI,
  },
  {
    name: 'Anthropic',
    env: 'ANTHROPIC_API_KEY',
    desc: 'Claude Sonnet for SEO optimization and trend discovery',
    docsUrl: 'https://console.anthropic.com/',
    configured: false,
  },
  {
    name: 'ElevenLabs',
    env: 'ELEVENLABS_API_KEY',
    desc: 'AI voice generation for video narration',
    docsUrl: 'https://elevenlabs.io/',
    configured: false,
  },
  {
    name: 'Runway',
    env: 'RUNWAY_API_KEY',
    desc: 'AI video generation (Gen-3)',
    docsUrl: 'https://runwayml.com/',
    configured: false,
  },
  {
    name: 'Cloudinary',
    env: 'CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET',
    desc: 'Video and image storage and processing',
    docsUrl: 'https://cloudinary.com/',
    configured: false,
  },
  {
    name: 'Resend',
    env: 'RESEND_API_KEY',
    desc: 'Transactional email for notifications and invites',
    docsUrl: 'https://resend.com/',
    configured: false,
  },
]

export default function ApiKeysPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
        <p className="text-muted-foreground">
          API keys are configured via Vercel environment variables, not stored in the app.
        </p>
      </div>

      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm text-yellow-800">
            <strong>Security note:</strong> Never store API keys in code or the database. Add them as environment variables in your Vercel project dashboard under Settings → Environment Variables.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {INTEGRATIONS.map((integration) => (
          <Card key={integration.name}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="rounded-lg bg-muted p-2 mt-0.5 shrink-0">
                    <Key className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{integration.name}</p>
                      <Badge variant={integration.configured ? 'default' : 'outline'} className="text-xs">
                        {integration.configured ? 'Configured' : 'Not set'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{integration.desc}</p>
                    <p className="text-xs font-mono text-muted-foreground mt-1">{integration.env}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="shrink-0" asChild>
                  <a href={integration.docsUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add to Vercel</CardTitle>
          <CardDescription>Run these commands to add missing environment variables</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto">{`vercel env add OPENAI_API_KEY production
vercel env add ANTHROPIC_API_KEY production
vercel env add ELEVENLABS_API_KEY production
vercel env add RUNWAY_API_KEY production
vercel env add CLOUDINARY_CLOUD_NAME production
vercel env add CLOUDINARY_API_KEY production
vercel env add CLOUDINARY_API_SECRET production
vercel env add RESEND_API_KEY production
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
vercel env add STRIPE_PRICE_STARTER production
vercel env add STRIPE_PRICE_PRO production
vercel env add STRIPE_PRICE_AGENCY production`}</pre>
        </CardContent>
      </Card>
    </div>
  )
}
