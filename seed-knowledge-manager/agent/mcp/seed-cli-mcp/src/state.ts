/**
 * Ephemeral runtime state on disk:
 *
 *   activity-cursor.json — last activity event token consumed by the poller
 *   inbox.jsonl          — pending mentions queued for processing
 *   processed.jsonl      — mentions already answered (idempotency)
 *   rate-counters.json   — per-day / per-run counters (limits.ts)
 *
 * Files live under `${stateDir}` (default `/home/km/km-state`). All writes
 * go through `O_APPEND` (jsonl) or atomic rename (json) so a crash never
 * corrupts state. Wrapper exposes inbox_pop / inbox_mark_done / cursor_*
 * tools to the LLM so the orchestration loop is observable but state
 * mutation is controlled.
 */

import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {Mention} from './mentions.js'
import type {RateState} from './limits.js'
import {newRateState} from './limits.js'

const CURSOR_FILE = 'activity-cursor.json'
const INBOX_FILE = 'inbox.jsonl'
const PROCESSED_FILE = 'processed.jsonl'
const RATE_FILE = 'rate-counters.json'
const PLACEHOLDERS_FILE = 'placeholders.jsonl'

/**
 * Pending placeholder reply: a comment we already posted on Seed but
 * have not yet replaced with the final answer. Used by the two-pass
 * polling loop (placeholder first, then DeepSeek + edit). Survives
 * process crashes.
 */
export type PlaceholderRecord = {
  mentionId: string // mentionKey(...)
  placeholderId: string // commentId returned by `comment create`
  postedAt: string
  /** Original mention payload — kept so the next run can build a reply
   *  without re-fetching/re-classifying the source comment. */
  mention: import('./mentions.js').Mention
  /** Whether the placeholder has been replaced via `comment edit`. */
  finalised: boolean
}

export class State {
  constructor(private readonly stateDir: string) {
    if (!existsSync(stateDir)) mkdirSync(stateDir, {recursive: true, mode: 0o700})
  }

  // ─── cursor ────────────────────────────────────────────────────────────────
  //
  // We track the latest activity-event id we've already classified. Each
  // poll fetches the first page of activity (newest-first) and stops as
  // soon as it sees this id. Stored as a small JSON blob for forward
  // compatibility (future: track per-resource cursors).

  getCursor(): string | null {
    return this.readJson<{lastEventId?: string} | null>(CURSOR_FILE, null)?.lastEventId ?? null
  }

  setCursor(eventId: string): void {
    this.writeJsonAtomic(CURSOR_FILE, {lastEventId: eventId, ts: new Date().toISOString()})
  }

  // ─── inbox ─────────────────────────────────────────────────────────────────

  enqueue(mention: Mention): void {
    if (this.isProcessed(mentionKey(mention))) return
    appendFileSync(join(this.stateDir, INBOX_FILE), JSON.stringify(mention) + '\n')
  }

  /** Returns and removes the oldest queued mention, if any. */
  popFromInbox(): Mention | null {
    const path = join(this.stateDir, INBOX_FILE)
    if (!existsSync(path)) return null
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    if (lines.length === 0) return null
    const first = lines.shift()!
    writeFileSync(path, lines.length ? lines.join('\n') + '\n' : '', {mode: 0o600})
    try {
      return JSON.parse(first) as Mention
    } catch {
      return null
    }
  }

  inboxSize(): number {
    const path = join(this.stateDir, INBOX_FILE)
    if (!existsSync(path)) return 0
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean).length
  }

  // ─── processed (idempotency) ───────────────────────────────────────────────

  markProcessed(mention: Mention, runId: string, status: 'replied' | 'not-allowed' | 'error'): void {
    const record = {key: mentionKey(mention), runId, status, ts: new Date().toISOString()}
    appendFileSync(join(this.stateDir, PROCESSED_FILE), JSON.stringify(record) + '\n')
  }

  isProcessed(key: string): boolean {
    const path = join(this.stateDir, PROCESSED_FILE)
    if (!existsSync(path)) return false
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as {key?: string}
        if (r.key === key) return true
      } catch {
        /* skip */
      }
    }
    return false
  }

  // ─── rate counters ─────────────────────────────────────────────────────────

  /**
   * Returns the persisted per-day counters, plus an empty per-run counter
   * map. `perRun` is by definition scoped to the current process — we
   * never restore it from disk. Storing it on disk would conflate
   * separate invocations and turn a "max per run" limit into a "max ever"
   * limit, which is what we used to do (bug).
   */
  getRateState(): RateState {
    const persisted = this.readJson<RateState>(RATE_FILE, newRateState())
    return {...persisted, perRun: {}}
  }

  /**
   * Persists only the per-day portion. `perRun` is dropped on write.
   */
  setRateState(state: RateState): void {
    this.writeJsonAtomic(RATE_FILE, {day: state.day, perDay: state.perDay, perRun: {}})
  }

  // ─── placeholders (typing-indicator) ───────────────────────────────────────

  /**
   * Record a freshly-posted placeholder. Append-only so a crash never
   * leaves us unsure whether the comment was created.
   */
  recordPlaceholder(rec: PlaceholderRecord): void {
    appendFileSync(join(this.stateDir, PLACEHOLDERS_FILE), JSON.stringify(rec) + '\n')
  }

  /** All placeholders that haven't been finalised yet. */
  pendingPlaceholders(): PlaceholderRecord[] {
    const path = join(this.stateDir, PLACEHOLDERS_FILE)
    if (!existsSync(path)) return []
    const out: PlaceholderRecord[] = []
    // Walk backwards so the latest record for a mention wins.
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    const seen = new Map<string, PlaceholderRecord>()
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as PlaceholderRecord
        seen.set(rec.mentionId, rec)
      } catch {
        /* skip */
      }
    }
    for (const rec of seen.values()) {
      if (!rec.finalised) out.push(rec)
    }
    return out
  }

  /** Mark a placeholder finalised (replaced via comment edit). */
  finalisePlaceholder(mentionId: string, placeholderId: string): void {
    const path = join(this.stateDir, PLACEHOLDERS_FILE)
    if (!existsSync(path)) return
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    const out: string[] = []
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as PlaceholderRecord
        if (rec.mentionId === mentionId && rec.placeholderId === placeholderId) {
          rec.finalised = true
          out.push(JSON.stringify(rec))
        } else {
          out.push(line)
        }
      } catch {
        out.push(line)
      }
    }
    writeFileSync(path, out.join('\n') + '\n', {mode: 0o600})
  }

  /** Was this mention already given a placeholder? */
  hasPlaceholderFor(mentionId: string): boolean {
    const path = join(this.stateDir, PLACEHOLDERS_FILE)
    if (!existsSync(path)) return false
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as PlaceholderRecord
        if (rec.mentionId === mentionId) return true
      } catch {
        /* skip */
      }
    }
    return false
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private readJson<T>(file: string, fallback: T): T {
    const path = join(this.stateDir, file)
    if (!existsSync(path)) return fallback
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T
    } catch {
      return fallback
    }
  }

  private writeJsonAtomic(file: string, value: unknown): void {
    const path = join(this.stateDir, file)
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600})
    renameSync(tmp, path)
  }
}

export function mentionKey(m: Mention): string {
  return m.kind === 'comment' ? `c:${m.commentId}` : `d:${m.docId}#${m.blockId ?? ''}`
}
