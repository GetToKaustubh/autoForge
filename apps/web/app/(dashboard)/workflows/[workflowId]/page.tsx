'use client'

import { use } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Play, CheckCircle2, XCircle, Clock, Loader2, ChevronRight } from 'lucide-react'

interface WorkflowStep {
  id: string
  type: string
  label?: string
}

interface StepResult {
  status: 'triggered' | 'completed' | 'failed'
  jobId?: string
  error?: string
  completedAt?: string
}

interface WorkflowRun {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  stepResults: Record<string, StepResult>
  startedAt: string
  completedAt: string | null
  error: string | null
}

interface Workflow {
  id: string
  name: string
  description: string | null
  triggerType: string
  isActive: boolean
  runCount: number
  steps: WorkflowStep[]
}

const RUN_STATUS_ICON = {
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
}

const STEP_STATUS_COLOR: Record<string, string> = {
  triggered: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export default function WorkflowDetailPage({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = use(params)
  const queryClient = useQueryClient()

  const { data: wfData, isLoading: wfLoading } = useQuery<{ workflow: Workflow }>({
    queryKey: ['workflow', workflowId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
  })

  const { data: runsData, isLoading: runsLoading } = useQuery<{ runs: WorkflowRun[] }>({
    queryKey: ['workflow-runs', workflowId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}/runs`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    refetchInterval: (q) => {
      const runs = q.state.data?.runs ?? []
      return runs.some((r) => r.status === 'running') ? 5000 : false
    },
  })

  const { mutate: triggerRun, isPending: triggering } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}/runs`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to trigger')
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs', workflowId] })
      void queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
  })

  const wf = wfData?.workflow
  const runs = runsData?.runs ?? []

  if (wfLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  )

  if (!wf) return (
    <div className="text-center py-20">
      <p className="text-muted-foreground">Workflow not found.</p>
      <Button asChild className="mt-4" variant="outline"><Link href="/workflows">Back</Link></Button>
    </div>
  )

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/workflows"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{wf.name}</h1>
          {wf.description && <p className="text-muted-foreground text-sm">{wf.description}</p>}
        </div>
        <Button onClick={() => triggerRun()} disabled={triggering}>
          {triggering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Run Now
        </Button>
      </div>

      {/* Workflow Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center flex-wrap gap-2">
            {wf.steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2">
                {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <div className="rounded-lg border px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground">{i + 1}.</span>{' '}
                  {step.label || step.type}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="capitalize">{wf.triggerType.replace(/_/g, ' ')} trigger</span>
            <span>·</span>
            <span>{wf.runCount} total runs</span>
            <span>·</span>
            <span className={wf.isActive ? 'text-green-600' : ''}>{wf.isActive ? 'Active' : 'Inactive'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run History</CardTitle>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No runs yet. Click Run Now to start.</p>
          ) : (
            <div className="divide-y">
              {runs.map((run) => (
                <div key={run.id} className="py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {RUN_STATUS_ICON[run.status]}
                      <span className="text-sm font-medium capitalize">{run.status}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                    </div>
                    {run.completedAt && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                      </span>
                    )}
                  </div>

                  {/* Step results */}
                  {Object.keys(run.stepResults ?? {}).length > 0 && (
                    <div className="ml-6 flex flex-wrap gap-1.5">
                      {wf.steps.map((step) => {
                        const result = run.stepResults[step.id]
                        if (!result) return null
                        return (
                          <span
                            key={step.id}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${STEP_STATUS_COLOR[result.status] ?? 'bg-muted text-muted-foreground'}`}
                            title={result.error ?? undefined}
                          >
                            {step.label || step.type}: {result.status}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {run.error && (
                    <p className="ml-6 text-xs text-destructive">{run.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
