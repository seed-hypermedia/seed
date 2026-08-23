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
