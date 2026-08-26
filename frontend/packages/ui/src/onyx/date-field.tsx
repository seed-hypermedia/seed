// The editor for Onyx's built-in date types. A value with `format: date` is
// an ISO 8601 calendar date (YYYY-MM-DD); `format: date-time` is an RFC 3339
// instant. Both stay plain strings on the wire — the picker is purely how the
// string is authored. Free text is still possible via the clear button (the
// field then falls back to the text input the schema-less editor would show).
import {Calendar as CalendarIcon, X} from 'lucide-react'
import {useMemo, useState} from 'react'
import {Button} from '../button'
import {Calendar} from '../components/calendar'
import {Popover, PopoverContent, PopoverTrigger} from '../components/popover'
import {Tooltip} from '../tooltip'
import {cn} from '../utils'

export type DateFieldMode = 'date' | 'date-time'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parse a YYYY-MM-DD string as a local calendar date (no timezone shift). */
export function parseIsoDate(value: string): Date | undefined {
  const m = DATE_RE.exec(value)
  if (!m) return undefined
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Format a local calendar date as YYYY-MM-DD. */
export function formatIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse an RFC 3339 instant; undefined when it doesn't parse. */
function parseInstant(value: string): Date | undefined {
  if (!value || !/T/.test(value)) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Format an instant as RFC 3339 in UTC, seconds precision (YYYY-MM-DDTHH:MM:SSZ). */
export function formatInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * A date (or date-and-time) picker bound to a string value. Renders the
 * current value in a readable form; the calendar (and, for date-time, a time
 * input) writes back the canonical ISO string. An empty value shows the
 * placeholder; a non-parsable value is shown verbatim so nothing is lost.
 */
export function DateValueField({
  value,
  mode,
  onValue,
  onClear,
  className,
}: {
  value: string
  mode: DateFieldMode
  onValue: (value: string) => void
  /** Clears the value (an empty string) — the row then offers plain text entry. */
  onClear?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const parsed = useMemo(() => (mode === 'date' ? parseIsoDate(value) : parseInstant(value)), [mode, value])
  const label = !value
    ? mode === 'date'
      ? 'Pick a date'
      : 'Pick a date and time'
    : parsed
      ? mode === 'date'
        ? parsed.toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'})
        : parsed.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
      : value

  // The time-of-day part of a date-time, as the <input type="time"> value (local).
  const timeText = parsed && mode === 'date-time' ? `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}` : '12:00'

  const commit = (day: Date | undefined, time = timeText) => {
    if (!day) {
      onValue('')
      return
    }
    if (mode === 'date') {
      onValue(formatIsoDate(day))
      return
    }
    const [h = '0', m = '0'] = time.split(':')
    const local = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(h), Number(m), 0, 0)
    onValue(formatInstant(local))
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={mode === 'date' ? 'Pick a date' : 'Pick a date and time'}
            data-testid="date-field"
            data-value={value}
            className={cn('min-w-0 justify-start gap-2 font-normal', !value && 'text-muted-foreground')}
          >
            <CalendarIcon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parsed}
            defaultMonth={parsed}
            captionLayout="dropdown"
            onSelect={(day) => {
              commit(day)
              if (mode === 'date') setOpen(false)
            }}
          />
          {mode === 'date-time' && (
            <div className="flex items-center gap-2 border-t p-2">
              <span className="text-muted-foreground text-xs">Time</span>
              <input
                type="time"
                aria-label="Time of day"
                className="bg-background rounded-md border px-2 py-1 text-sm"
                value={timeText}
                onChange={(e) => commit(parsed ?? new Date(), e.target.value)}
              />
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {value && onClear && (
        <Tooltip content="Clear date">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Clear date"
            className="text-muted-foreground"
            onClick={onClear}
          >
            <X className="size-3.5" />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
