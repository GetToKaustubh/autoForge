import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  title: string
  href: string
  icon: string  // Lucide icon name
  badge?: string
  children?: Omit<NavItem, 'children'>[]
}

export const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: 'LayoutDashboard',
  },
  {
    title: 'Channels',
    href: '/channels',
    icon: 'Youtube',
  },
  {
    title: 'Research',
    href: '/research',
    icon: 'Search',
    children: [
      { title: 'Niches', href: '/research/niches', icon: 'Target' },
      { title: 'Keywords', href: '/research/keywords', icon: 'Hash' },
      { title: 'Trends', href: '/research/trends', icon: 'TrendingUp' },
    ],
  },
  {
    title: 'Content',
    href: '/content',
    icon: 'FileText',
    children: [
      { title: 'Ideas', href: '/content/ideas', icon: 'Lightbulb' },
      { title: 'Scripts', href: '/content/scripts', icon: 'PenLine' },
      { title: 'Calendar', href: '/content/calendar', icon: 'CalendarDays' },
    ],
  },
  {
    title: 'Production',
    href: '/production',
    icon: 'Film',
    children: [
      { title: 'Voice', href: '/production/voice', icon: 'Mic2' },
      { title: 'Thumbnails', href: '/production/thumbnails', icon: 'Image' },
      { title: 'Videos', href: '/production/videos', icon: 'Video' },
    ],
  },
  {
    title: 'Publishing',
    href: '/publishing',
    icon: 'Upload',
    children: [
      { title: 'Upload', href: '/publishing/upload', icon: 'UploadCloud' },
      { title: 'SEO', href: '/publishing/seo', icon: 'BarChart2' },
      { title: 'History', href: '/publishing/history', icon: 'History' },
    ],
  },
  {
    title: 'Analytics',
    href: '/analytics',
    icon: 'LineChart',
    children: [
      { title: 'Overview', href: '/analytics', icon: 'PieChart' },
      { title: 'Revenue', href: '/analytics/revenue', icon: 'DollarSign' },
    ],
  },
  {
    title: 'Team',
    href: '/team',
    icon: 'Users',
  },
  {
    title: 'Workflows',
    href: '/workflows',
    icon: 'Zap',
  },
  {
    title: 'Monitoring',
    href: '/monitoring',
    icon: 'Activity',
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: 'Settings',
    children: [
      { title: 'General', href: '/settings', icon: 'SlidersHorizontal' },
      { title: 'Billing', href: '/settings/billing', icon: 'CreditCard' },
      { title: 'API Keys', href: '/settings/api-keys', icon: 'Key' },
    ],
  },
]
