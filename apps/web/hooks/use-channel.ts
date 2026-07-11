'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChannelStore } from '@/stores/channel-store'

export interface Channel {
  id: string
  ytChannelId: string
  channelName: string
  channelHandle: string | null
  channelThumbnail: string | null
  description: string | null
  country: string | null
  language: string | null
  subscriberCount: number | null
  videoCount: number | null
  viewCount: number | null
  defaultCategory: string | null
  defaultTags: string[] | null
  status: 'active' | 'suspended' | 'disconnected' | 'quota_exceeded'
  quotaUsedToday: number
  quotaLimitDaily: number
  isPrimary: boolean
  tokenExpiresAt: string | null
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      if (!res.ok) throw new Error('Failed to fetch channels')
      const data = await res.json()
      return data.channels as Channel[]
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useChannel(channelId: string | null) {
  return useQuery({
    queryKey: ['channel', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/channels/${channelId}`)
      if (!res.ok) throw new Error('Failed to fetch channel')
      const data = await res.json()
      return data.channel as Channel
    },
    enabled: !!channelId,
    staleTime: 1000 * 60 * 2,
  })
}

export function useChannelSync(channelId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/channels/${channelId}/sync`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Sync failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId] })
      queryClient.invalidateQueries({ queryKey: ['channels'] })
    },
  })
}

export function useActiveChannel() {
  const { activeChannel } = useChannelStore()
  return activeChannel
}
