import type {HMTimestamp} from '@seed-hypermedia/client/hm-types'

export type AnyTimestamp = string | Date | HMTimestamp | undefined

// Mirrors @shm/shared utils/date.ts normalizeDate
export function normalizeDate(value: AnyTimestamp): Date | null {
  if (typeof value === 'string') return new Date(value)
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'seconds' in value && value.seconds != null) {
    const seconds = typeof value.seconds === 'bigint' ? value.seconds : BigInt(Math.floor(Number(value.seconds)))
    return new Date(Number(seconds * 1000n))
  }
  return null
}

const hasRelativeDate = typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat !== 'undefined'
const relativeTimeFormatter = hasRelativeDate ? new Intl.RelativeTimeFormat('en-US', {style: 'short'}) : null

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Relative for recent dates (like the web's formattedDate), absolute beyond a week
export function formattedDate(value?: AnyTimestamp): string {
  const date = normalizeDate(value)
  if (!date || isNaN(date.getTime())) return ''
  const delta = Date.now() - date.getTime()
  if (relativeTimeFormatter && delta >= 0 && delta < 7 * DAY) {
    if (delta < MINUTE) return 'now'
    if (delta < HOUR) return relativeTimeFormatter.format(-Math.round(delta / MINUTE), 'minute')
    if (delta < DAY) return relativeTimeFormatter.format(-Math.round(delta / HOUR), 'hour')
    return relativeTimeFormatter.format(-Math.round(delta / DAY), 'day')
  }
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : {year: 'numeric'}),
  })
}

/**
 * Absolute short timestamps, matching the web's formattedDateShort used for
 * comments: time today, "MMM d, HH:mm" within a year, else with the year.
 */
export function formattedDateShort(value?: AnyTimestamp): string {
  const date = normalizeDate(value)
  if (!date || isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const time = date.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: false})
  if (sameDay) return time
  const withinYear = date.getTime() > Date.now() - 365 * 24 * 60 * 60 * 1000
  const day = date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})
  return withinYear ? `${day}, ${time}` : `${day} ${date.getFullYear()}, ${time}`
}
