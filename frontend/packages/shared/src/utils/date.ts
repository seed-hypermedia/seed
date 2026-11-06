import {Timestamp} from '@bufbuild/protobuf'
import {format, type Locale} from 'date-fns'
import type {Document} from '../client'
import type {HMTimestamp} from '@seed-hypermedia/client/hm-types'

type KeyOfType<T, U> = {
  [P in keyof T]: T[P] extends U ? P : never
}[keyof T]

export type DateKeys = Exclude<KeyOfType<Document, Timestamp | undefined>, undefined>

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const hasRelativeDate = typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat !== 'undefined'

/** Module-scoped formatter reused across calls to avoid repeated construction. */
const relativeTimeFormatter = hasRelativeDate ? new Intl.RelativeTimeFormat('en-US', {style: 'short'}) : null

export type AnyTimestamp = string | Date | Timestamp | HMTimestamp | undefined

export function formattedDate(value?: AnyTimestamp, options?: {onlyRelative?: boolean}) {
  let date = normalizeDate(value)
  if (!date) return ''
  if (hasRelativeDate) {
    // Intl.RelativeTimeFormat is supported
    return relativeFormattedDate(date, options)
    // Use the rtf object for relative time formatting
  } else {
    return date.toLocaleDateString('en', {
      day: '2-digit',
      month: '2-digit',
    })
  }
}

export function normalizeDate(value: AnyTimestamp) {
  let date: Date | null = null
  if (typeof value == 'string') {
    date = new Date(value)
  } else if (value instanceof Date) {
    date = value
  } else if (value?.seconds) {
    const seconds = typeof value.seconds === 'bigint' ? value.seconds : BigInt(value.seconds)
    // @ts-ignore
    date = new Date(Number(seconds * 1000n))
  }
  return date
}

export function formattedDateLong(
  value?: AnyTimestamp,
  options?: {
    locale?: Locale
  },
) {
  let date = normalizeDate(value)
  if (!date) return ''
  return format(date, 'MMMM do yyyy, HH:mm:ss z', {
    locale: options?.locale,
  })
}

export function formattedDateShort(
  value?: AnyTimestamp,
  options?: {
    locale?: Locale
  },
) {
  let date = normalizeDate(value)
  if (!date) return ''

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  // if same day, show only time
  if (today.getTime() === dateDay.getTime()) {
    return format(date, 'HH:mm', {
      locale: options?.locale,
    })
  }

  // if within the last year, show the month and day
  if (date.getTime() > Date.now() - 365 * 24 * 60 * 60 * 1000) {
    return format(date, 'MMM d, HH:mm', {
      locale: options?.locale,
    })
  }

  // otherwise, show the full date with year
  return format(date, 'MMM d yyyy, HH:mm', {
    locale: options?.locale,
  })
}

export function formattedDateMedium(
  value?: AnyTimestamp,
  options?: {
    locale?: Locale
  },
) {
  let date = normalizeDate(value)
  if (!date) return ''
  // if (hasRelativeDate) {
  //   return relativeFormattedDate(date, {onlyRelative: false})
  // }
  return format(date, 'd MMMM yyyy, HH:mm', {
    locale: options?.locale,
  })
}

export function formattedDateDayOnly(
  value?: AnyTimestamp,
  options?: {
    locale?: Locale
  },
) {
  let date = normalizeDate(value)
  if (!date) return ''
  return format(date, 'd MMMM yyyy', {
    locale: options?.locale,
  })
}

function relativeFormattedDate(value?: AnyTimestamp, options?: {onlyRelative?: boolean}) {
  const onlyRelative = !!options?.onlyRelative
  var now = new Date()
  let date = normalizeDate(value)
  if (!date) return ''
  const formatter = relativeTimeFormatter!

  var result = difference(date, now)

  let relative = 'just now'
  if (result.year < -1) {
    relative = formatter.format(Math.floor(result.year), 'year')
  } else if (result.day < -30) {
    relative = formatter.format(Math.floor(result.day / 30), 'month')
  } else if (result.day < -1) {
    relative = formatter.format(Math.floor(result.day), 'day')
  } else if (result.hour < -1) {
    relative = formatter.format(Math.floor(result.hour), 'hour')
  } else if (result.minute < -2) {
    relative = formatter.format(Math.floor(result.minute), 'minute')
  }

  if (onlyRelative) {
    return relative
  } else if (result.year < -1) {
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
  } else if (result.day > -1) {
    return relative
  } else {
    return `${date.getDate()} ${months[date.getMonth()]}`
    // within the same year: 9 Sep (day + short month)
  }
}

function difference(date1: Date, date2: Date) {
  const date1utc = Date.UTC(
    date1.getFullYear(),
    date1.getMonth(),
    date1.getDate(),
    date1.getHours(),
    date1.getMinutes(),
  )
  const date2utc = Date.UTC(
    date2.getFullYear(),
    date2.getMonth(),
    date2.getDate(),
    date2.getHours(),
    date2.getMinutes(),
  )
  var year = 1000 * 60 * 60 * 24 * 30 * 12
  var day = 1000 * 60 * 60 * 24
  var hour = 1000 * 60 * 60
  var minute = 1000 * 60

  return {
    year: (date1utc - date2utc) / year,
    day: (date1utc - date2utc) / day,
    hour: (date1utc - date2utc) / hour,
    minute: (date1utc - date2utc) / minute,
  }
}

const spokenRelativeFormatter = hasRelativeDate
  ? new Intl.RelativeTimeFormat('en-US', {numeric: 'auto', style: 'long'})
  : null

/**
 * How long ago, the way people say it: "just now", "5 minutes ago", "3 hours ago", "yesterday",
 * "4 days ago", "last week", "2 months ago". Falls back to a short date without Intl support.
 */
export function formattedTimeAgo(value?: AnyTimestamp, now: Date = new Date()): string {
  const date = normalizeDate(value)
  if (!date) return ''
  if (!spokenRelativeFormatter) return formattedDateShort(date)
  const seconds = (date.getTime() - now.getTime()) / 1000
  const ago = -seconds
  if (ago < 60) return 'just now'
  const minutes = ago / 60
  if (minutes < 60) return spokenRelativeFormatter.format(-Math.floor(minutes), 'minute')
  const hours = minutes / 60
  if (hours < 24) return spokenRelativeFormatter.format(-Math.floor(hours), 'hour')
  // Days count calendar days, so something from last night reads "yesterday" this morning.
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000)
  if (days < 7) return spokenRelativeFormatter.format(-Math.max(days, 1), 'day')
  if (days < 30) return spokenRelativeFormatter.format(-Math.floor(days / 7), 'week')
  if (days < 365) return spokenRelativeFormatter.format(-Math.floor(days / 30), 'month')
  return spokenRelativeFormatter.format(-Math.floor(days / 365), 'year')
}
