import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest, NextFetchEvent } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',   // Clerk, Trigger.dev, YouTube webhooks bypass auth
  '/api/health',
])

const clerkHandler = clerkMiddleware(async (auth, req: NextRequest) => {
  if (!isPublicRoute(req)) {
    const { userId, orgId } = await auth.protect()

    // Inject org context header for downstream API routes
    const headers = new Headers(req.headers)
    if (orgId) headers.set('x-org-id', orgId)
    if (userId) headers.set('x-user-id', userId)

    return NextResponse.next({ request: { headers } })
  }
})

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  // Pass through when Clerk is not configured (initial deploy without env vars).
  // Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY in Vercel to enable auth.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    return NextResponse.next()
  }
  return clerkHandler(req, event)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|_next).*)',
    '/',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
}
