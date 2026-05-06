/**
 * Path allow/deny matching and rate caps. The rules object is the
 * machine-readable YAML block parsed out of the `agent-rules` Seed
 * document; see `governance.ts`.
 *
 * Globstar semantics: `**` matches any number of path segments,
 * `*` matches one segment.
 *
 *   /agents/knowledge-manager/state/**  matches  /agents/knowledge-manager/state/foo/bar
 *   /digests/*                          matches  /digests/2026-W19  but not /digests/x/y
 *
 * Deny always beats allow. The four governance docs are protected by
 * a hardcoded denylist regardless of what the rules say.
 */

export type Rules = {
  schemaVersion: number
  allowWritePaths: string[]
  denyWritePaths: string[]
  caps: {
    maxDocumentsPerRun: number
    maxCommentsPerRun: number
    maxCommentsPerDay: number
    pollIntervalSeconds: number
  }
  mentions: {
    trigger: string
    invokerSource: 'writer-capabilities' | 'allowlist-doc'
  }
  moderation: {
    blockedAuthors: string[]
  }
  draftOnly: boolean
  language: string
}

const HARDCODED_DENY = [
  '/agents/knowledge-manager/charter',
  '/agents/knowledge-manager/rules',
  '/agents/knowledge-manager/runbook',
  '/agents/knowledge-manager/allowlist',
]

export function isWriteAllowed(path: string, rules: Rules): {allowed: true} | {allowed: false; reason: string} {
  const normalized = normalizePath(path)
  for (const pattern of HARDCODED_DENY) {
    if (matchPath(pattern, normalized)) {
      return {allowed: false, reason: `hardcoded-deny: ${pattern}`}
    }
  }
  for (const pattern of rules.denyWritePaths) {
    if (matchPath(pattern, normalized)) {
      return {allowed: false, reason: `rules-deny: ${pattern}`}
    }
  }
  for (const pattern of rules.allowWritePaths) {
    if (matchPath(pattern, normalized)) {
      return {allowed: true}
    }
  }
  return {allowed: false, reason: `not-in-allowlist`}
}

export function normalizePath(path: string): string {
  if (!path) return '/'
  if (!path.startsWith('/')) path = '/' + path
  return path.replace(/\/+$/, '') || '/'
}

export function matchPath(pattern: string, path: string): boolean {
  const p = normalizePath(pattern)
  const t = normalizePath(path)
  if (p === t) return true
  // Sole `/` means "root and everything below it" — i.e. site-wide allow.
  if (p === '/') return true
  // Convert glob to regex.
  const regex = '^' + p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // double-star: any number of segments
    .replace(/\*\*/g, '«DOUBLESTAR»')
    // single star: one segment
    .replace(/\*/g, '[^/]+')
    .replace(/«DOUBLESTAR»/g, '.*') + '$'
  return new RegExp(regex).test(t)
}

// ─── Rate caps ──────────────────────────────────────────────────────────────

export type RateState = {
  /** Calendar day (UTC) the per-day counters belong to. */
  day: string
  perDay: Record<string, number>
  perRun: Record<string, number>
}

export function newRateState(): RateState {
  return {day: utcDay(new Date()), perDay: {}, perRun: {}}
}

export function bump(state: RateState, key: string): RateState {
  const today = utcDay(new Date())
  const next = state.day === today ? state : {...state, day: today, perDay: {}}
  next.perDay = {...next.perDay, [key]: (next.perDay[key] ?? 0) + 1}
  next.perRun = {...next.perRun, [key]: (next.perRun[key] ?? 0) + 1}
  return next
}

export function checkCap(
  state: RateState,
  key: 'documents' | 'comments',
  rules: Rules,
): {allowed: true} | {allowed: false; reason: string} {
  const today = utcDay(new Date())
  const dayCount = state.day === today ? state.perDay[key] ?? 0 : 0
  const runCount = state.perRun[key] ?? 0
  if (key === 'documents' && runCount >= rules.caps.maxDocumentsPerRun) {
    return {allowed: false, reason: `cap: max_documents_per_run (${rules.caps.maxDocumentsPerRun}) reached`}
  }
  if (key === 'comments' && runCount >= rules.caps.maxCommentsPerRun) {
    return {allowed: false, reason: `cap: max_comments_per_run (${rules.caps.maxCommentsPerRun}) reached`}
  }
  if (key === 'comments' && dayCount >= rules.caps.maxCommentsPerDay) {
    return {allowed: false, reason: `cap: max_comments_per_day (${rules.caps.maxCommentsPerDay}) reached`}
  }
  return {allowed: true}
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}
