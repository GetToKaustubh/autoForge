import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',   // Clerk, Trigger.dev, YouTube webhooks bypass auth
  '/api/health',
])

export default clerkMiddleware(async (auth, req: NextRequest) => {
  if (!isPublicRoute(req)) {
    const { userId, orgId } = await auth.protect()

    // Inject org context header for downstream API routes
    const headers = new Headers(req.headers)
    if (orgId) headers.set('x-org-id', orgId)
    if (userId) headers.set('x-user-id', userId)

    return NextResponse.next({ request: { headers } })
  }
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|_next).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
}
