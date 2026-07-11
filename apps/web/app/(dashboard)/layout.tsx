export const dynamic = 'force-dynamic'

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { QueryProvider } from '@/components/shared/query-provider'
import { ChannelInitializer } from '@/components/channels/channel-initializer'
import { getOrgMember } from '@/lib/auth/get-member'
import { redis } from '@/lib/cache/redis'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await auth()

  if (!userId) redirect('/sign-in')
  if (!orgId) redirect('/select-org')

  // Suspension check — admin can suspend orgs via /admin
  const member = await getOrgMember(orgId, userId)
  if (member) {
    const suspended = await redis.get(`admin:suspended:${member.orgDbId}`)
    if (suspended) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
          <div className="max-w-md text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <span className="text-red-600 text-xl">⛔</span>
            </div>
            <h1 className="text-xl font-bold">Organization Suspended</h1>
            <p className="text-muted-foreground text-sm">
              This organization has been suspended by platform administration.
              Please contact support to resolve this.
            </p>
          </div>
        </div>
      )
    }
  }

  return (
    <QueryProvider>
      <ChannelInitializer />
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  )
}
