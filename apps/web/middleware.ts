import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest, NextFetchEvent } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/select-org(.*)',
  '/api/webhooks/(.*)',
  '/api/health',
  '/api/auth/youtube/callback', // Google redirects here — no Clerk org context in request
  '/api/autopilot/approve', // clicked from an email link, secured by its own token instead
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
  // Clerk's "Membership required" setting intercepts this route at the edge
  // before our handler runs — even when marked as public. Neither callback
  // calls auth(), so it's safe to bypass Clerk entirely here. The approve
  // route is clicked from an email link and secured by its own token instead
  // of a session — a signed-out or wrong-account browser must still work.
  if (req.nextUrl.pathname === '/api/auth/youtube/callback' || req.nextUrl.pathname === '/api/autopilot/approve') {
    return NextResponse.next()
  }

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
