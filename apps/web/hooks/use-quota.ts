'use client'

import { useQuery } from '@tanstack/react-query'

interface QuotaData {
  used: number
  limit: number
  remaining: number
  percentUsed: number
  uploadsRemaining: number
  status: string
  costs: Record<string, number>
}

export function useChannelQuota(channelId: string | null, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['quota', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/channels/${channelId}/quota`)
      if (!res.ok) throw new Error('Failed to fetch quota')
      const data = await res.json()
      return data.quota as QuotaData
    },
    enabled: !!channelId,
    refetchInterval: opts?.refetchInterval ?? 1000 * 60,
    staleTime: 1000 * 30,
  })
}
