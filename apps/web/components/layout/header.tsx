'use client'

import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'
import { Bell, Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChannelStore } from '@/stores/channel-store'

export function Header() {
  const activeChannel = useChannelStore((s) => s.activeChannel)

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      {/* Active channel indicator */}
      <div className="flex items-center gap-3">
        {activeChannel ? (
          <div className="flex items-center gap-2">
            {activeChannel.channelThumbnail ? (
              <img
                src={activeChannel.channelThumbnail}
                alt={activeChannel.channelName}
                className="h-7 w-7 rounded-full"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                <Youtube className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="text-sm font-medium leading-none">{activeChannel.channelName}</p>
              {activeChannel.channelHandle && (
                <p className="text-xs text-muted-foreground">{activeChannel.channelHandle}</p>
              )}
            </div>
            {/* Quota indicator */}
            <QuotaBadge
              used={activeChannel.quotaUsedToday}
              limit={activeChannel.quotaLimitDaily}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No channel selected</p>
        )}
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-3">
        <OrganizationSwitcher
          hidePersonal
          appearance={{
            elements: {
              rootBox: 'text-sm',
              organizationSwitcherTrigger: 'rounded-md border border-input px-3 py-1.5 text-sm',
            },
          }}
        />
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
        </Button>
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'h-8 w-8',
            },
          }}
        />
      </div>
    </header>
  )
}

function QuotaBadge({ used, limit }: { used: number; limit: number }) {
  const percentage = Math.round((used / limit) * 100)
  const color =
    percentage >= 90 ? 'text-red-500 bg-red-50' :
    percentage >= 70 ? 'text-yellow-600 bg-yellow-50' :
    'text-green-600 bg-green-50'

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      Quota {percentage}%
    </span>
  )
}
