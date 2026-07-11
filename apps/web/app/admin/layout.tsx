import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth/admin-guard'
import Link from 'next/link'
import { LayoutDashboard, Building2, Users, ShieldCheck } from 'lucide-react'

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/admin/users', label: 'Users', icon: Users },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin()
  if (!admin) redirect('/')

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-background">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <ShieldCheck className="h-5 w-5 text-destructive" />
          <span className="font-semibold text-sm">Platform Admin</span>
        </div>
        <nav className="p-2 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-4 left-2 right-0 w-52 px-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to app
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
