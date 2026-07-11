'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft, Save, CheckCircle, Clock, FileText, Loader2, Send
} from 'lucide-react'
import { useRouter } from 'next/navigation'

type ScriptStatus = 'draft' | 'review' | 'approved' | 'in_production' | 'archived'

interface ScriptSection {
  type: 'hook' | 'intro' | 'main' | 'cta' | 'outro'
  content: string
  duration_sec?: number
  notes?: string
}

interface Script {
  id: string
  title: string
  sections: ScriptSection[]
  fullText: string | null
  wordCount: number | null
  estimatedDurationSec: number | null
  version: number
  modelUsed: string | null
  status: ScriptStatus
  approvedAt: string | null
  triggerJobId: string | null
  ideaId: string | null
  updatedAt: string
}

const SECTION_COLORS: Record<string, string> = {
  hook: 'bg-yellow-100 border-yellow-300 text-yellow-800',
  intro: 'bg-blue-100 border-blue-300 text-blue-800',
  main: 'bg-purple-100 border-purple-300 text-purple-800',
  cta: 'bg-green-100 border-green-300 text-green-800',
  outro: 'bg-gray-100 border-gray-300 text-gray-700',
}

function formatDuration(sec: number | null) {
  if (!sec) return null
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const STATUS_BADGE: Record<ScriptStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  review: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  in_production: 'bg-blue-100 text-blue-800',
  archived: 'bg-gray-100 text-gray-500',
}

export default function ScriptEditorPage({ params }: { params: Promise<{ scriptId: string }> }) {
  const { scriptId } = use(params)
  const router = useRouter()
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState(0)
  const [isDirty, setIsDirty] = useState(false)

  const { data: script, isLoading } = useQuery({
    queryKey: ['script', scriptId],
    queryFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}`)
      if (!res.ok) throw new Error('Script not found')
      return res.json() as Promise<Script>
    },
    refetchInterval: (q) => {
      const s = q.state.data
      if (!s) return false
      const isGenerating = !!s.triggerJobId && s.status === 'draft' && !s.wordCount
      return isGenerating ? 3000 : false
    },
  })

  const sections = script?.sections ?? []
  const currentSection = sections[activeSection]

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Write your script here...' }),
    ],
    content: currentSection?.content ?? '',
    onUpdate: () => setIsDirty(true),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[400px] p-4',
      },
    },
  })

  // Sync editor content when section changes
  useEffect(() => {
    if (editor && currentSection?.content !== undefined) {
      const current = editor.getHTML()
      if (current !== currentSection.content) {
        editor.commands.setContent(currentSection.content)
        setIsDirty(false)
      }
    }
  }, [activeSection, editor, currentSection?.content])

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      if (!script || !editor) return
      const updatedSections = sections.map((s, i) =>
        i === activeSection ? { ...s, content: editor.getText() } : s
      )
      const res = await fetch(`/api/content/scripts/${scriptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: updatedSections }),
      })
      if (!res.ok) throw new Error('Failed to save')
      return res.json() as Promise<Script>
    },
    onSuccess: (updated) => {
      if (updated) void queryClient.setQueryData(['script', scriptId], updated)
      setIsDirty(false)
    },
  })

  const { mutate: submitReview, isPending: isSubmitting } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'review' }),
      })
      if (!res.ok) throw new Error('Failed to submit')
      return res.json() as Promise<Script>
    },
    onSuccess: (updated) => {
      if (updated) void queryClient.setQueryData(['script', scriptId], updated)
    },
  })

  const { mutate: approve, isPending: isApproving } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to approve')
      return res.json()
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['script', scriptId] }),
  })

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-4xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    )
  }

  if (!script) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>Script not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>Go back</Button>
      </div>
    )
  }

  const isGenerating = !!script.triggerJobId && script.status === 'draft' && !script.wordCount

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push('/content/scripts')}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold truncate">{script.title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[script.status]}`}>
            {script.status}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {script.wordCount && (
            <span className="text-sm text-muted-foreground hidden sm:block">
              {script.wordCount.toLocaleString()} words · {formatDuration(script.estimatedDurationSec)}
            </span>
          )}
          {script.status === 'draft' && sections.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => submitReview()} disabled={isSubmitting}>
              <Send className="h-3.5 w-3.5 mr-1.5" />Submit for Review
            </Button>
          )}
          {script.status === 'review' && (
            <Button size="sm" onClick={() => approve()} disabled={isApproving}>
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />Approve
            </Button>
          )}
          {isDirty && (
            <Button size="sm" onClick={() => save()} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save</>}
            </Button>
          )}
        </div>
      </div>

      {isGenerating ? (
        <div className="rounded-xl border border-dashed p-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="font-medium">AI is writing your script...</p>
          <p className="text-sm text-muted-foreground mt-1">This usually takes 1–2 minutes</p>
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-xl border">
          <div className="p-4 border-b bg-muted/30">
            <p className="text-sm font-medium">Script Editor</p>
          </div>
          <EditorContent editor={editor} className="min-h-[400px]" />
        </div>
      ) : (
        <div className="grid grid-cols-[200px_1fr] gap-4">
          {/* Section nav */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 mb-2">Sections</p>
            {sections.map((section, i) => (
              <button
                key={i}
                onClick={() => { if (isDirty) save(); setActiveSection(i) }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  i === activeSection ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${SECTION_COLORS[section.type] ?? ''}`}>
                    {section.type}
                  </span>
                </div>
                {section.duration_sec && (
                  <p className={`text-xs mt-0.5 flex items-center gap-1 ${i === activeSection ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    <Clock className="h-2.5 w-2.5" />{formatDuration(section.duration_sec)}
                  </p>
                )}
              </button>
            ))}
            {script.wordCount && (
              <div className="pt-3 px-2 border-t mt-3">
                <p className="text-xs text-muted-foreground">{script.wordCount.toLocaleString()} total words</p>
                <p className="text-xs text-muted-foreground">{formatDuration(script.estimatedDurationSec)} est.</p>
              </div>
            )}
          </div>

          {/* Editor */}
          <div className="rounded-xl border overflow-hidden">
            {currentSection?.notes && (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
                <p className="text-xs text-amber-800 font-medium">Director notes: {currentSection.notes}</p>
              </div>
            )}
            <EditorContent editor={editor} />
          </div>
        </div>
      )}
    </div>
  )
}
