'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import { navItems, type NavItem } from './nav-items'
import {
  LayoutDashboard, Youtube, Search, Target, Hash, TrendingUp,
  FileText, Lightbulb, PenLine, CalendarDays, Film, Mic2, Image,
  Video, Workflow, Upload, Clock, BarChart2, History, LineChart,
  PieChart, DollarSign, Users, Zap, Activity, Settings,
  SlidersHorizontal, CreditCard, Key, ChevronDown,
} from 'lucide-react'
import { useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard, Youtube, Search, Target, Hash, TrendingUp,
  FileText, Lightbulb, PenLine, CalendarDays, Film, Mic2, Image,
  Video, Workflow, Upload, Clock, BarChart2, History, LineChart,
  PieChart, DollarSign, Users, Zap, Activity, Settings,
  SlidersHorizontal, CreditCard, Key,
}

function NavIcon({ name }: { name: string }) {
  const Icon = iconMap[name]
  if (!Icon) return null
  return <Icon className="h-4 w-4 shrink-0" />
}

function NavItemComponent({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(() => {
    if (!item.children) return false
    return item.children.some((c) => pathname === c.href || pathname.startsWith(c.href + '/'))
  })

  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
  const isExactActive = pathname === item.href

  if (item.children) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isActive && !open && 'bg-sidebar-accent text-sidebar-primary',
            depth > 0 && 'pl-6'
          )}
        >
          <NavIcon name={item.icon} />
          <span className="flex-1 text-left">{item.title}</span>
          <ChevronDown
            className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 space-y-1">
            {item.children.map((child) => (
              <NavItemComponent key={child.href} item={child} depth={depth + 1} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isExactActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
          : 'text-sidebar-foreground',
        depth > 0 && 'pl-6'
      )}
    >
      <NavIcon name={item.icon} />
      <span>{item.title}</span>
      {item.badge && (
        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
          {item.badge}
        </span>
      )}
    </Link>
  )
}

export function Sidebar() {
  return (
    <aside className="flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-youtube-red">
          <Youtube className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-bold tracking-tight text-sidebar-foreground">TubeForge</span>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavItemComponent key={item.href} item={item} />
          ))}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        <p className="text-xs text-muted-foreground text-center">
          TubeForge v0.1.0
        </p>
      </div>
    </aside>
  )
}
