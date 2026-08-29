import type {AgentRunUsage, SessionEventMeta} from './client'

/**
 * What a logged event can say about itself — who originated and signed it, how long it took, what
 * it cost, which model produced it — reduced to display rows.
 *
 * The runtime stamps this at append time, so most of it is simply read back. But the log is older
 * than the stamp: every event recorded before `meta` existed has none, and even a stamped event may
 * carry only part of it (a tool result knows its duration and nothing about tokens). So this is
 * strictly additive — a field nobody knows produces no row at all, rather than a labelled blank.
 *
 * Kept free of React so the formatting is unit-testable on its own.
 */

/** One labelled fact about an event, as the info dialogs list it. */
export type EventMetaRow = {label: string; value: string}

/** Wall time in human units: sub-second in ms, then seconds, then minutes. */
export function formatEventDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}

/** Token counts read like counts, not like ids: grouped thousands. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) return ''
  return Math.round(tokens).toLocaleString('en-US')
}

/**
 * An absolute event timestamp, second-precise, in the reader's locale and timezone. The date is
 * always included: info dialogs get opened on transcripts hours or days old, where a bare clock
 * time quietly misleads.
 */
export function formatEventTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * When the event happened, as the dialogs label it: one instant for a message, start/finish for a
 * tool call whose two durable events bound its execution.
 */
export type EventTimes = {
  /** When a message was appended to the log. */
  sentAt?: number
  /** When a tool call was issued. */
  startedAt?: number
  /** When its result landed. */
  completedAt?: number
}

/** Sum of the categories when the stamp did not carry its own total. */
function usageTotal(usage: AgentRunUsage): number {
  if (typeof usage.total === 'number' && usage.total > 0) return usage.total
  return (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0)
}

/**
 * The rows an info dialog shows for one event: model, provider, timing, and the turn's token
 * breakdown. Empty when nothing is known — which is the signal to render no stats section at all.
 */
export function eventMetaRows(meta: SessionEventMeta | undefined, times?: EventTimes): EventMetaRow[] {
  if (!meta && !times) return []
  const rows: EventMetaRow[] = []
  if (meta?.accountId) rows.push({label: 'Originator', value: meta.accountId})
  if (meta?.signerId) rows.push({label: 'Signer', value: meta.signerId})
  if (meta?.model) rows.push({label: 'Model', value: meta.model})
  if (meta?.provider) rows.push({label: 'Provider', value: meta.provider})
  if (times?.sentAt) {
    const value = formatEventTime(times.sentAt)
    if (value) rows.push({label: 'Time', value})
  }
  if (times?.startedAt) {
    const value = formatEventTime(times.startedAt)
    if (value) rows.push({label: 'Started', value})
  }
  if (times?.completedAt) {
    const value = formatEventTime(times.completedAt)
    if (value) rows.push({label: 'Finished', value})
  }
  if (typeof meta?.durationMs === 'number' && meta.durationMs >= 0) {
    rows.push({label: 'Duration', value: formatEventDuration(meta.durationMs)})
  }
  const usage = meta?.usage
  if (usage) {
    const total = usageTotal(usage)
    if (total > 0) rows.push({label: 'Tokens', value: `${formatTokenCount(total)} tokens`})
    if (usage.input) rows.push({label: 'Input', value: formatTokenCount(usage.input)})
    if (usage.output) rows.push({label: 'Output', value: formatTokenCount(usage.output)})
    if (usage.cacheRead) rows.push({label: 'Cache read', value: formatTokenCount(usage.cacheRead)})
    if (usage.cacheWrite) rows.push({label: 'Cache write', value: formatTokenCount(usage.cacheWrite)})
  }
  return rows
}
