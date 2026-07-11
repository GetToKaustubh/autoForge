import { create } from 'zustand'

interface PipelineJob {
  id: string
  type: 'voice' | 'thumbnail' | 'video' | 'upload' | 'seo'
  resourceId: string
  triggerJobId: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number
  startedAt: Date
}

interface PipelineStore {
  activeJobs: PipelineJob[]
  addJob: (job: PipelineJob) => void
  updateJob: (id: string, updates: Partial<PipelineJob>) => void
  removeJob: (id: string) => void
  clearCompleted: () => void
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  activeJobs: [],

  addJob: (job) =>
    set((s) => ({ activeJobs: [...s.activeJobs, job] })),

  updateJob: (id, updates) =>
    set((s) => ({
      activeJobs: s.activeJobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
    })),

  removeJob: (id) =>
    set((s) => ({ activeJobs: s.activeJobs.filter((j) => j.id !== id) })),

  clearCompleted: () =>
    set((s) => ({
      activeJobs: s.activeJobs.filter(
        (j) => j.status !== 'completed' && j.status !== 'failed'
      ),
    })),
}))
