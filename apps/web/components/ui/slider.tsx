import * as React from 'react'
import { cn } from '@/lib/utils/cn'

export interface SliderProps {
  min?: number
  max?: number
  step?: number
  value: [number]
  onValueChange: (value: [number]) => void
  className?: string
  disabled?: boolean
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ min = 0, max = 1, step = 0.01, value, onValueChange, className, disabled }, ref) => {
    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[0]}
        disabled={disabled}
        onChange={(e) => onValueChange([parseFloat(e.target.value)])}
        className={cn(
          'w-full h-2 rounded-full accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
      />
    )
  }
)
Slider.displayName = 'Slider'

export { Slider }
