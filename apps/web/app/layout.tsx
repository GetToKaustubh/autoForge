export const dynamic = 'force-dynamic'

import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: {
    default: 'TubeForge — YouTube Automation Platform',
    template: '%s | TubeForge',
  },
  description:
    'Production-grade YouTube automation: AI research, script generation, voice synthesis, video creation, and publishing — all in one platform.',
  keywords: ['youtube automation', 'ai content creation', 'youtube management', 'video automation'],
  authors: [{ name: 'TubeForge' }],
  creator: 'TubeForge',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={`${inter.variable} font-sans antialiased`}>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </body>
      </html>
    </ClerkProvider>
  )
}
