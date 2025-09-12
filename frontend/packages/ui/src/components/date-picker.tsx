'use client'

import {Calendar as CalendarIcon, X} from 'lucide-react'
import * as React from 'react'

import {Button} from '../button'
import {cn} from '../utils'
import {Calendar} from './calendar'
import {Popover, PopoverContent, PopoverTrigger} from './popover'

export interface DatePickerProps {
  value: string
  onValue: (value: string) => void
  onReset: () => void
  placeholder?: string
  className?: string
}

export function DatePicker({
  value,
  onValue,
  onReset,
  placeholder = 'Select date',
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Parse the input value to a Date object
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined
    const date = new Date(value)
    return isNaN(date.getTime()) ? undefined : date
  }, [value])

  // Format date for display
  const formatDate = (date: Date | undefined) => {
    if (!date) return ''
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      onReset()
    } else {
      // Convert to the same format as the original SimpleDatePicker
      // Adjust the local date to UTC date (maintaining the original behavior)
      const adjustedDate = new Date(
        date.getTime() - date.getTimezoneOffset() * 60000,
      )
      onValue(adjustedDate.toISOString().slice(0, 10))
    }
    setOpen(false)
  }

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation()
    onReset()
  }

  return (
    <div
      className={cn(
        'flex w-full min-w-full items-center sm:min-w-0',
        className,
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild className="w-full">
          <Button
            className={cn(
              'w-full justify-start text-left font-normal',
              !selectedDate && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selectedDate ? formatDate(selectedDate) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            captionLayout="dropdown"
          />
        </PopoverContent>
      </Popover>
      {selectedDate && (
        <Button onClick={handleReset}>
          <X className="size-4" />
        </Button>
      )}
    </div>
  )
}
