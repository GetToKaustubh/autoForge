import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb', // allow larger video metadata payloads
    },
  },

  // Packages that use Node.js internals — must not be bundled by webpack
  serverExternalPackages: ['pino', 'pino-pretty', 'postgres'],

  images: {
    remotePatterns: [
      // YouTube
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'yt3.ggpht.com' },
      { protocol: 'https', hostname: 'yt3.googleusercontent.com' },
      // Clerk user avatars
      { protocol: 'https', hostname: 'img.clerk.com' },
      { protocol: 'https', hostname: '*.clerk.accounts.dev' },
      // DALL-E generated images (temporary signed URLs)
      { protocol: 'https', hostname: 'oaidalleapiprodscus.blob.core.windows.net' },
    ],
  },

  async redirects() {
    return [
      // Root → dashboard; Clerk middleware handles the auth gate
      { source: '/', destination: '/dashboard', permanent: false },
    ]
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://clerk.accounts.dev https://*.clerk.accounts.dev https://js.stripe.com https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              // Supabase realtime, Clerk WS, Upstash, AI APIs, ElevenLabs
              "connect-src 'self' https://api.clerk.com wss://ws.clerk.com https://*.clerk.accounts.dev https://challenges.cloudflare.com https://*.supabase.co wss://*.supabase.co https://*.upstash.io https://api.openai.com https://api.anthropic.com https://api.elevenlabs.io https://api.runwayml.com",
              "media-src 'self' blob: https://res.cloudinary.com",
              // Stripe iframes for payment elements
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.clerk.accounts.dev https://challenges.cloudflare.com",
              // TipTap editor uses blob workers
              "worker-src 'self' blob:",
            ].join('; '),
          },
        ],
      },
      // Immutable cache for hashed Next.js static assets
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  widenClientFileUpload: true,
  sourcemaps: { disable: true },
  disableLogger: true,
})
