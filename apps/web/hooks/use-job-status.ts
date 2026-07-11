'use client'

import { useQuery } from '@tanstack/react-query'

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface JobStatusResult<T = unknown> {
  status: JobStatus
  data: T | null
  error: string | null
  progress?: number
}

export function useJobStatus<T = unknown>(
  resourceType: string,
  resourceId: string | null,
  opts?: {
    refetchInterval?: number
    enabled?: boolean
  }
) {
  return useQuery<JobStatusResult<T>>({
    queryKey: ['job-status', resourceType, resourceId],
    queryFn: async () => {
      const res = await fetch(`/api/${resourceType}/${resourceId}/status`)
      if (!res.ok) throw new Error('Failed to fetch job status')
      return res.json()
    },
    enabled: (opts?.enabled ?? true) && !!resourceId,
    refetchInterval: (query) => {
      const data = query.state.data as JobStatusResult<T> | undefined
      if (data?.status === 'completed' || data?.status === 'failed') return false
      return opts?.refetchInterval ?? 5000
    },
    staleTime: 0,
  })
}

export function usePipelineStage(videoId: string | null) {
  return useQuery({
    queryKey: ['pipeline-stage', videoId],
    queryFn: async () => {
      const res = await fetch(`/api/production/videos/${videoId}`)
      if (!res.ok) throw new Error('Failed to fetch video')
      const data = await res.json()
      return data.video as {
        id: string
        pipelineStage: string
        title: string
        triggerJobId: string | null
      }
    },
    enabled: !!videoId,
    refetchInterval: (query) => {
      const stage = (query.state.data as { pipelineStage: string } | undefined)?.pipelineStage
      const terminalStages = ['published', 'failed', 'draft']
      if (stage && terminalStages.includes(stage)) return false
      return 5000
    },
    staleTime: 0,
  })
}
