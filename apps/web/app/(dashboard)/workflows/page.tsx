'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Plus, Zap, Play, Trash2, Settings, Clock, ChevronRight } from 'lucide-react'

interface WorkflowStep {
  id: string
  type: string
  label?: string
  config: Record<string, unknown>
}

interface Workflow {
  id: string
  name: string
  description: string | null
  triggerType: string
  isActive: boolean
  runCount: number
  lastRunAt: string | null
  steps: WorkflowStep[]
  createdAt: string
}

const STEP_TYPES = [
  { value: 'niche-research', label: 'Niche Research' },
  { value: 'keyword-research', label: 'Keyword Research' },
  { value: 'trend-discovery', label: 'Trend Discovery' },
  { value: 'idea-generation', label: 'Idea Generation' },
  { value: 'script-generation', label: 'Script Generation' },
  { value: 'voice-generation', label: 'Voice Generation' },
  { value: 'thumbnail-generation', label: 'Thumbnail Generation' },
  { value: 'video-generation', label: 'Video Generation' },
  { value: 'seo-optimization', label: 'SEO Optimization' },
  { value: 'youtube-upload', label: 'YouTube Upload' },
  { value: 'send-notification', label: 'Send Notification' },
]

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual' },
  { value: 'scheduled', label: 'Scheduled (Cron)' },
  { value: 'on_idea_approved', label: 'On Idea Approved' },
  { value: 'on_script_approved', label: 'On Script Approved' },
]

const TRIGGER_BADGE: Record<string, string> = {
  manual: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-800',
  on_idea_approved: 'bg-purple-100 text-purple-800',
  on_script_approved: 'bg-indigo-100 text-indigo-800',
}

function newStep(): WorkflowStep {
  const type = 'idea-generation'
  return { id: crypto.randomUUID(), type, label: STEP_TYPES.find((t) => t.value === type)!.label, config: {} }
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState('manual')
  const [steps, setSteps] = useState<WorkflowStep[]>([newStep()])

  const { mutate: create, isPending } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, triggerType, triggerConfig: {}, steps }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(typeof err.error === 'string' ? err.error : 'Failed to create')
      }
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setName(''); setDescription(''); setTriggerType('manual'); setSteps([newStep()])
      onClose()
    },
  })

  const addStep = () => setSteps((s) => [...s, newStep()])
  const removeStep = (id: string) => setSteps((s) => s.filter((x) => x.id !== id))
  const updateStep = (id: string, type: string) =>
    setSteps((s) => s.map((x) => x.id === id ? { ...x, type, label: STEP_TYPES.find((t) => t.value === type)?.label ?? type } : x))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly content pipeline" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Trigger</label>
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Steps</label>
              <Button variant="ghost" size="sm" onClick={addStep}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add Step
              </Button>
            </div>
            {steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                <Select value={step.type} onValueChange={(v) => updateStep(step.id, v)}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STEP_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeStep(step.id)}
                  disabled={steps.length === 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create()} disabled={isPending || !name.trim() || steps.length === 0}>
            {isPending ? 'Creating…' : 'Create Workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function WorkflowsPage() {
  const [creating, setCreating] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<{ workflows: Workflow[] }>({
    queryKey: ['workflows'],
    queryFn: async () => {
      const res = await fetch('/api/workflows')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { mutate: runWorkflow, isPending: running, variables: runningId } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workflows/${id}/runs`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to trigger')
      return res.json()
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  })

  const { mutate: deleteWorkflow } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  })

  const wfs = data?.workflows ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground">Automate your content pipeline with multi-step workflows</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-2" />New Workflow
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : wfs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Zap className="mx-auto h-12 w-12 text-muted-foreground opacity-40" />
          <h2 className="mt-4 text-lg font-semibold">No workflows yet</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
            Create a workflow to automate your content pipeline — research, scripting, production, and publishing.
          </p>
          <Button className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />Create Workflow
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {wfs.map((wf) => (
            <Card key={wf.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{wf.name}</CardTitle>
                    {wf.description && (
                      <CardDescription className="text-xs mt-0.5 truncate">{wf.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TRIGGER_BADGE[wf.triggerType] ?? ''}`}>
                      {wf.triggerType.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${wf.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                      {wf.isActive ? 'active' : 'inactive'}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(wf.steps as WorkflowStep[]).map((s, i) => (
                    <div key={s.id} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {STEP_TYPES.find((t) => t.value === s.type)?.label ?? s.type}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {wf.runCount} runs
                    {wf.lastRunAt && ` · last ${new Date(wf.lastRunAt).toLocaleDateString()}`}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => runWorkflow(wf.id)}
                      disabled={running && runningId === wf.id}>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                      <Link href={`/workflows/${wf.id}`}><Settings className="h-3.5 w-3.5" /></Link>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm('Delete this workflow?')) deleteWorkflow(wf.id) }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
