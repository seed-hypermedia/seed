/**
 * Formatting helpers for the agents surfaces.
 *
 * The agents protocol stamps times as epoch milliseconds, while the app's existing `formattedDate`
 * takes strings, Dates and HM timestamps — so the bridge lives here rather than being re-derived at
 * every call site.
 */

import {formattedDate} from '../utils/dates'

/** Relative time for a durable timestamp (epoch ms), matching the document surfaces' wording. */
export function formatRelativeTime(ms: number | undefined): string {
  if (!ms) return ''
  return formattedDate(new Date(ms))
}

/** Compact elapsed time for a live or finished run: `4s`, `1m 12s`, `2h 5m`. */
export function formatDuration(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '0s'
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`
  return `${seconds}s`
}

/** Token counts, abbreviated so a long run's usage still fits a phone's card header. */
export function formatTokens(count: number | undefined): string {
  if (!count) return '0'
  if (count < 1000) return String(count)
  if (count < 1_000_000) {
    const thousands = count / 1000
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`
  }
  return `${(count / 1_000_000).toFixed(1)}M`
}
