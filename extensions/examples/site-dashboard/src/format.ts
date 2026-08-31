/** Small formatting helpers for hypermedia values that arrive over the bridge. */

/** Timestamps come as `{seconds, nanos}` (seconds may be a bigint or number) or an ISO/RFC string. */
export function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'object' && 'seconds' in value) {
    const seconds = Number((value as {seconds: unknown}).seconds)
    return Number.isNaN(seconds) ? null : new Date(seconds * 1000)
  }
  return null
}

export function formatTime(value: unknown): string {
  const date = toDate(value)
  if (!date) return ''
  const ageMs = Date.now() - date.getTime()
  const minutes = Math.round(ageMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days} d ago`
  return date.toLocaleDateString()
}

export function shortId(uid: string): string {
  return uid.length > 12 ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : uid
}
