'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CalendarDays, Plus, ChevronLeft, ChevronRight, Loader2, Trash2 } from 'lucide-react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO } from 'date-fns'
import { useActiveChannel } from '@/hooks/use-channel'

type CalendarStatus = 'planned' | 'in_production' | 'ready' | 'published' | 'skipped'
type CalendarType = 'video' | 'short' | 'live' | 'community_post'

interface CalendarEntry {
  id: string
  title: string
  plannedDate: string
  plannedTime: string | null
  type: CalendarType
  status: CalendarStatus
  notes: string | null
  color: string | null
}

const TYPE_COLORS: Record<CalendarType, string> = {
  video: 'bg-blue-500',
  short: 'bg-purple-500',
  live: 'bg-red-500',
  community_post: 'bg-green-500',
}

const STATUS_LABELS: Record<CalendarStatus, string> = {
  planned: 'Planned',
  in_production: 'In Production',
  ready: 'Ready',
  published: 'Published',
  skipped: 'Skipped',
}

function AddEntryDialog({ open, onClose, channelId, defaultDate }: {
  open: boolean; onClose: () => void; channelId: string; defaultDate: string
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('12:00')
  const [type, setType] = useState<CalendarType>('video')
  const queryClient = useQueryClient()

  const { mutate: create, isPending } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/content/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, title, plannedDate: date, plannedTime: time, type }),
      })
      if (!res.ok) throw new Error('Failed to create')
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      setTitle('')
      onClose()
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Calendar</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Video title or plan" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CalendarType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="short">Short</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="community_post">Community Post</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => create()} disabled={!title.trim() || !date || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [showAdd, setShowAdd] = useState(false)
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const queryClient = useQueryClient()
  const activeChannel = useActiveChannel()

  const from = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
  const to = format(endOfMonth(currentMonth), 'yyyy-MM-dd')

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', activeChannel?.id, from, to],
    queryFn: async () => {
      if (!activeChannel) return { entries: [] }
      const params = new URLSearchParams({ channelId: activeChannel.id, from, to })
      const res = await fetch(`/api/content/calendar?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ entries: CalendarEntry[] }>
    },
    enabled: !!activeChannel,
  })

  const { mutate: deleteEntry } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/content/calendar/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  })

  const entries = data?.entries ?? []
  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })

  // Pad days to start on Sunday
  const startPad = startOfMonth(currentMonth).getDay()

  const entriesOnDay = (day: Date) =>
    entries.filter((e) => e.plannedDate === format(day, 'yyyy-MM-dd'))

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <CalendarDays className="h-10 w-10 mb-3 opacity-30" />
        <p className="font-medium">No channel selected</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Content Calendar</h1>
        <Button onClick={() => { setSelectedDate(format(new Date(), 'yyyy-MM-dd')); setShowAdd(true) }}>
          <Plus className="h-4 w-4 mr-2" />Add Entry
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{format(currentMonth, 'MMMM yyyy')}</CardTitle>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date())}>Today</Button>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <div>
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
                ))}
              </div>
              {/* Calendar grid */}
              <div className="grid grid-cols-7">
                {/* Padding cells */}
                {Array.from({ length: startPad }).map((_, i) => (
                  <div key={`pad-${i}`} className="border border-transparent p-1 min-h-24" />
                ))}
                {days.map((day) => {
                  const dayEntries = entriesOnDay(day)
                  const isToday = isSameDay(day, new Date())
                  return (
                    <div
                      key={day.toISOString()}
                      className={`border border-muted rounded-sm p-1 min-h-24 cursor-pointer hover:bg-muted/30 transition-colors ${isToday ? 'bg-primary/5 border-primary/30' : ''}`}
                      onClick={() => { setSelectedDate(format(day, 'yyyy-MM-dd')); setShowAdd(true) }}
                    >
                      <span className={`text-xs font-medium block mb-1 ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                        {format(day, 'd')}
                      </span>
                      <div className="space-y-0.5">
                        {dayEntries.map((e) => (
                          <div
                            key={e.id}
                            className="flex items-center gap-1 group"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${e.color ?? TYPE_COLORS[e.type]}`} />
                            <span className="text-xs truncate flex-1">{e.title}</span>
                            <button
                              onClick={() => deleteEntry(e.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="h-2.5 w-2.5 text-destructive" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
            <span className="capitalize">{type.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      <AddEntryDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        channelId={activeChannel.id}
        defaultDate={selectedDate}
      />
    </div>
  )
}
