'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useChannelStore } from '@/stores/channel-store'

export function ChannelInitializer() {
  const setChannels = useChannelStore((s) => s.setChannels)

  const { data } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      if (!res.ok) return []
      const json = await res.json() as { channels: any[] }
      return json.channels ?? []
    },
    staleTime: 2 * 60 * 1000,
  })

  useEffect(() => {
    if (data) setChannels(data)
  }, [data, setChannels])

  return null
}
