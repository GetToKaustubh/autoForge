'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { diffWords } from 'diff'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sparkles, Send, Loader2, Check, X, RefreshCw, Pencil, Undo2, Redo2,
  History, User, Bot, ChevronDown, ChevronUp, Columns2, GitCompare,
} from 'lucide-react'

interface ScriptSection {
  type: string
  content: string
  duration_sec?: number
  notes?: string
}

interface EditMessage {
  id: string
  instruction: string
  proposedSections: ScriptSection[] | null
  proposedFullText: string | null
  status: 'pending' | 'accepted' | 'discarded'
  resultVersionId: string | null
  regenerationCount: number
  errorMessage: string | null
  createdAt: string
}

interface ScriptVersion {
  id: string
  versionNumber: number
  instruction: string | null
  fullText: string | null
  wordCount: number | null
  isCurrent: boolean
  createdAt: string
}

interface UpdatedScript {
  sections: ScriptSection[]
  fullText: string | null
  wordCount: number | null
  estimatedDurationSec: number | null
  version: number
}

const MAX_TEXTAREA_HEIGHT = 200

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after)
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? 'bg-green-100 text-green-800 rounded px-0.5'
              : part.removed
              ? 'bg-red-100 text-red-700 line-through rounded px-0.5'
              : ''
          }
        >
          {part.value}
        </span>
      ))}
    </div>
  )
}

function ScriptComparison({ before, after }: { before: string; after: string }) {
  const [mode, setMode] = useState<'diff' | 'side-by-side'>('diff')
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={mode === 'diff' ? 'default' : 'outline'}
          onClick={() => setMode('diff')}
          className="h-7 text-xs"
        >
          <GitCompare className="h-3 w-3 mr-1" />Diff
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'side-by-side' ? 'default' : 'outline'}
          onClick={() => setMode('side-by-side')}
          className="h-7 text-xs"
        >
          <Columns2 className="h-3 w-3 mr-1" />Side by Side
        </Button>
      </div>
      {mode === 'diff' ? (
        <div className="rounded-lg border bg-muted/20 p-3 max-h-64 overflow-y-auto">
          <DiffView before={before} after={after} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 max-h-64 overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Current</p>
            <p className="text-sm whitespace-pre-wrap">{before}</p>
          </div>
          <div className="rounded-lg border p-3 max-h-64 overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">AI-Proposed</p>
            <p className="text-sm whitespace-pre-wrap">{after}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function VersionHistoryPanel({
  scriptId,
  currentFullText,
  onClose,
  onRestored,
}: {
  scriptId: string
  currentFullText: string
  onClose: () => void
  onRestored: (script: UpdatedScript) => void
}) {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['script-versions', scriptId],
    queryFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}/versions`)
      if (!res.ok) throw new Error('Failed to load version history')
      return res.json() as Promise<{ versions: ScriptVersion[]; currentVersionId: string | null }>
    },
  })

  const { mutate: restore, isPending } = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await fetch(`/api/content/scripts/${scriptId}/versions/${versionId}/restore`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to restore version')
      }
      return res.json() as Promise<{ script: UpdatedScript }>
    },
    onSuccess: (result) => {
      toast.success('Version restored')
      onRestored(result.script)
      void queryClient.invalidateQueries({ queryKey: ['script-versions', scriptId] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to restore version'),
  })

  const versions = [...(data?.versions ?? [])].reverse()

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />Version History</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : versions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No versions yet</div>
          ) : (
            <div className="space-y-2 pb-2">
              {versions.map((v) => (
                <div key={v.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Version {v.versionNumber}</span>
                        {v.isCurrent && <Badge className="bg-green-500/10 text-green-700 border-green-500/20">Current</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {v.instruction ?? 'Original generated script'} · {formatTime(v.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}>
                        {expandedId === v.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                      {!v.isCurrent && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={isPending}
                          onClick={() => {
                            if (confirm(`Restore Version ${v.versionNumber}? This becomes the new current version — nothing is deleted.`)) {
                              restore(v.id)
                            }
                          }}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </div>
                  {expandedId === v.id && (
                    <div className="mt-3">
                      <ScriptComparison before={currentFullText} after={v.fullText ?? ''} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

export function AiScriptEditor({
  scriptId,
  open,
  onClose,
  currentFullText,
  hasContent,
  onScriptUpdated,
}: {
  scriptId: string
  open: boolean
  onClose: () => void
  currentFullText: string
  hasContent: boolean
  onScriptUpdated: (script: UpdatedScript) => void
}) {
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollEndRef = useRef<HTMLDivElement>(null)

  const { data: messagesData } = useQuery({
    queryKey: ['script-edit-messages', scriptId],
    queryFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}/edit-messages`)
      if (!res.ok) throw new Error('Failed to load conversation')
      return res.json() as Promise<{ messages: EditMessage[] }>
    },
    enabled: open,
  })

  const { data: versionsData } = useQuery({
    queryKey: ['script-versions', scriptId],
    queryFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}/versions`)
      if (!res.ok) throw new Error('Failed to load versions')
      return res.json() as Promise<{ canUndo: boolean; canRedo: boolean }>
    },
    enabled: open,
  })

  const messages = messagesData?.messages ?? []
  const pending = messages.find((m) => m.status === 'pending')

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [prompt])

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['script-edit-messages', scriptId] })
    void queryClient.invalidateQueries({ queryKey: ['script-versions', scriptId] })
  }

  const { mutate: send, isPending: isSending } = useMutation({
    mutationFn: async (instruction: string) => {
      const res = await fetch(`/api/content/scripts/${scriptId}/edit-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'AI edit failed')
      }
      return res.json() as Promise<EditMessage>
    },
    onSuccess: () => {
      setPrompt('')
      invalidateAll()
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'AI edit failed'
      toast.error(message, { action: { label: 'Retry', onClick: () => send(prompt.trim()) } })
    },
  })

  const { mutate: regenerate, isPending: isRegenerating } = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await fetch(`/api/content/scripts/${scriptId}/edit-messages/${messageId}/regenerate`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to regenerate')
      }
      return res.json()
    },
    onSuccess: invalidateAll,
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to regenerate'),
  })

  const { mutate: accept, isPending: isAccepting } = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await fetch(`/api/content/scripts/${scriptId}/edit-messages/${messageId}/accept`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Failed to accept changes')
      }
      return res.json() as Promise<{ script: UpdatedScript }>
    },
    onSuccess: (result) => {
      toast.success('Changes accepted')
      onScriptUpdated(result.script)
      invalidateAll()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to accept changes'),
  })

  const { mutate: discard, isPending: isDiscarding } = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await fetch(`/api/content/scripts/${scriptId}/edit-messages/${messageId}/discard`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to discard changes')
      return res.json()
    },
    onSuccess: () => {
      toast('Changes discarded')
      invalidateAll()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to discard changes'),
  })

  const { mutate: undo, isPending: isUndoing } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}/undo`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Nothing to undo')
      }
      return res.json() as Promise<{ script: UpdatedScript }>
    },
    onSuccess: (result) => {
      toast.success('Undone')
      onScriptUpdated(result.script)
      invalidateAll()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Nothing to undo'),
  })

  const { mutate: redo, isPending: isRedoing } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content/scripts/${scriptId}/redo`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Nothing to redo')
      }
      return res.json() as Promise<{ script: UpdatedScript }>
    },
    onSuccess: (result) => {
      toast.success('Redone')
      onScriptUpdated(result.script)
      invalidateAll()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Nothing to redo'),
  })

  const handleSubmit = () => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      toast.error('Please describe the changes you want to make.')
      return
    }
    if (pending || isSending) return
    send(trimmed)
  }

  const busy = isSending || isRegenerating || isAccepting || isDiscarding

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-3xl h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />AI Script Editor
            </DialogTitle>
            <div className="flex items-center gap-1 mr-6">
              <Button
                size="sm" variant="ghost" className="h-7 text-xs" title="Undo last accepted change"
                disabled={!versionsData?.canUndo || isUndoing || isRedoing}
                onClick={() => undo()}
              >
                {isUndoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 text-xs" title="Redo"
                disabled={!versionsData?.canRedo || isUndoing || isRedoing}
                onClick={() => redo()}
              >
                {isRedoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Redo2 className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowHistory(true)}>
                <History className="h-3.5 w-3.5 mr-1" />Version History
              </Button>
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 px-4">
            <div className="py-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  <Sparkles className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  Tell AI how you want to modify your script.
                  <div className="mt-2 text-xs space-y-0.5">
                    <p>&bull; Make the introduction more engaging.</p>
                    <p>&bull; Remove repetitive information.</p>
                    <p>&bull; Add more details to the second section.</p>
                    <p>&bull; Make the tone humorous and conversational.</p>
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  <div className="flex items-start gap-2 justify-end">
                    <div className="rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3.5 py-2 max-w-[85%]">
                      <p className="text-sm whitespace-pre-wrap">{m.instruction}</p>
                      <p className="text-[10px] opacity-70 mt-1">{formatTime(m.createdAt)}</p>
                    </div>
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 max-w-[90%] flex-1 space-y-2">
                      {m.errorMessage ? (
                        <p className="text-sm text-destructive">{m.errorMessage}</p>
                      ) : m.status === 'pending' ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/20">Pending Review</Badge>
                            {m.regenerationCount > 0 && (
                              <span className="text-[10px] text-muted-foreground">regenerated {m.regenerationCount}x</span>
                            )}
                          </div>
                          <ScriptComparison before={currentFullText} after={m.proposedFullText ?? ''} />
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => accept(m.id)}>
                              {isAccepting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                              Accept Changes
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => discard(m.id)}>
                              {isDiscarding ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <X className="h-3 w-3 mr-1" />}
                              Discard
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => regenerate(m.id)}>
                              {isRegenerating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                              Regenerate
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
                              onClick={() => setPrompt(m.instruction)}
                            >
                              <Pencil className="h-3 w-3 mr-1" />Edit Instruction
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <Badge className={m.status === 'accepted'
                            ? 'bg-green-500/10 text-green-700 border-green-500/20'
                            : 'bg-gray-500/10 text-gray-600 border-gray-500/20'}
                          >
                            {m.status === 'accepted' ? 'Accepted' : 'Discarded'}
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={scrollEndRef} />
            </div>
          </ScrollArea>

          <div className="border-t p-3 space-y-1.5">
            {pending && (
              <p className="text-xs text-muted-foreground px-1">
                Accept, discard, or regenerate the proposal above before sending a new instruction.
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                placeholder={
                  hasContent
                    ? 'Tell AI how you want to modify your script... (Ctrl/Cmd + Enter to send)'
                    : 'Generate or add a script before opening the AI Script Editor.'
                }
                disabled={!hasContent || !!pending || isSending}
                className="min-h-[44px] resize-none"
                rows={1}
              />
              <Button
                size="icon"
                disabled={!hasContent || !!pending || isSending || !prompt.trim()}
                onClick={handleSubmit}
                className="shrink-0"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            {isSending && (
              <p className="text-xs text-muted-foreground px-1">AI is analyzing your instructions and updating the script...</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showHistory && (
        <VersionHistoryPanel
          scriptId={scriptId}
          currentFullText={currentFullText}
          onClose={() => setShowHistory(false)}
          onRestored={(script) => {
            onScriptUpdated(script)
            invalidateAll()
          }}
        />
      )}
    </>
  )
}
