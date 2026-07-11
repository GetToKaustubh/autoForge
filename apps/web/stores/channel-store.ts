import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ChannelInfo {
  id: string
  ytChannelId: string
  channelName: string
  channelHandle: string | null
  channelThumbnail: string | null
  subscriberCount: number
  quotaUsedToday: number
  quotaLimitDaily: number
  status: string
}

interface ChannelStore {
  activeChannel: ChannelInfo | null
  channels: ChannelInfo[]
  setActiveChannel: (channel: ChannelInfo | null) => void
  setChannels: (channels: ChannelInfo[]) => void
  updateQuota: (channelId: string, quotaUsed: number) => void
}

export const useChannelStore = create<ChannelStore>()(
  persist(
    (set) => ({
      activeChannel: null,
      channels: [],

      setActiveChannel: (channel) => set({ activeChannel: channel }),

      setChannels: (channels) =>
        set((state) => ({
          channels,
          // Keep active channel in sync, or auto-select primary
          activeChannel:
            state.activeChannel
              ? channels.find((c) => c.id === state.activeChannel!.id) ?? channels[0] ?? null
              : channels.find((c) => c.status === 'active') ?? channels[0] ?? null,
        })),

      updateQuota: (channelId, quotaUsed) =>
        set((state) => ({
          channels: state.channels.map((c) =>
            c.id === channelId ? { ...c, quotaUsedToday: quotaUsed } : c
          ),
          activeChannel:
            state.activeChannel?.id === channelId
              ? { ...state.activeChannel, quotaUsedToday: quotaUsed }
              : state.activeChannel,
        })),
    }),
    {
      name: 'tubeforge-active-channel',
      partialize: (state) => ({ activeChannel: state.activeChannel }),
    }
  )
)
