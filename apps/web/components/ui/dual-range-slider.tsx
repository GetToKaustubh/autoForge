'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'

export interface DualRangeSliderProps {
  min: number
  max: number
  step?: number
  value: [number, number]
  onValueChange: (value: [number, number]) => void
  disabled?: boolean
  className?: string
}

// Two native range inputs stacked on top of each other - each one keeps its
// own thumb draggable/keyboard-navigable for free (native accessibility),
// while a shared track underneath renders the highlighted selected range.
// The thumb whose value is closer to a given pointer position gets pointer
// priority via z-index so both ends stay independently grabbable even when
// they're close together.
export function DualRangeSlider({
  min,
  max,
  step = 1,
  value,
  onValueChange,
  disabled,
  className,
}: DualRangeSliderProps) {
  const [start, end] = value
  const range = Math.max(max - min, step)
  const startPct = ((start - min) / range) * 100
  const endPct = ((end - min) / range) * 100

  const handleStartChange = (v: number) => {
    const next = Math.min(v, end - step)
    onValueChange([Math.max(min, next), end])
  }
  const handleEndChange = (v: number) => {
    const next = Math.max(v, start + step)
    onValueChange([start, Math.min(max, next)])
  }

  return (
    <div className={cn('relative h-6 flex items-center', className)}>
      <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted" />
      <div
        className="absolute h-1.5 rounded-full bg-primary"
        style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
      />
      <input
        type="range"
        aria-label="Scene start time"
        min={min}
        max={max}
        step={step}
        value={start}
        disabled={disabled}
        onChange={(e) => handleStartChange(parseFloat(e.target.value))}
        className={cn(
          'range-thumb absolute inset-x-0 h-6 w-full appearance-none bg-transparent cursor-pointer disabled:cursor-not-allowed',
          start > (max - min) / 2 + min ? 'z-20' : 'z-10'
        )}
      />
      <input
        type="range"
        aria-label="Scene end time"
        min={min}
        max={max}
        step={step}
        value={end}
        disabled={disabled}
        onChange={(e) => handleEndChange(parseFloat(e.target.value))}
        className={cn(
          'range-thumb absolute inset-x-0 h-6 w-full appearance-none bg-transparent cursor-pointer disabled:cursor-not-allowed',
          start > (max - min) / 2 + min ? 'z-10' : 'z-20'
        )}
      />
      <style jsx>{`
        .range-thumb::-webkit-slider-thumb {
          appearance: none;
          pointer-events: auto;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: hsl(var(--primary));
          border: 2px solid hsl(var(--background));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          cursor: pointer;
        }
        .range-thumb::-moz-range-thumb {
          pointer-events: auto;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: hsl(var(--primary));
          border: 2px solid hsl(var(--background));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          cursor: pointer;
        }
        .range-thumb::-webkit-slider-runnable-track {
          background: transparent;
        }
        .range-thumb::-moz-range-track {
          background: transparent;
        }
      `}</style>
    </div>
  )
}
