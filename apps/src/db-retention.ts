/**
 * Bounded database growth.
 *
 * The agents database only ever grew: every session kept its Pi Durable store (a second copy of its
 * transcript, see durable-session.ts) for as long as the session existed, every workflow run kept
 * every journaled call and result for as long as the run existed, and every tool result was stored
 * whole however large. Production reached 50 GB, far past what a 4 GB container can keep in cache,
 * and every read that missed went to a slow disk (2026-11-10 incident, seed#1335).
 *
 * This module holds the three things that bound it:
 *
 * - {@link boundPersistedToolOutput}: a size cap on the tool output a session stores. The model
 *   never reads more than 8 KiB of a result (`boundModelToolResultText`); the cap only limits what
 *   is kept for people to inspect.
 * - Durable-store retirement: the Pi Durable store of a session nobody has touched for a while is
 *   dropped. Nothing visible changes. The store is rebuilt from the session's log on the session's
 *   next turn, the path a lost store already takes; what is lost is provider-specific replay state
 *   (reasoning items, prompt-cache affinity) of a conversation idle for weeks.
 * - Journal compaction: a finished workflow run's journal is never replayed again (terminal status
 *   is sticky, see runs.ts), so after a while its large payloads are cut down to previews. The run
 *   inspector keeps every entry, its kind, tool, status and error; only bulky inputs and outputs are
 *   shortened, with a marker saying so.
 *
 * {@link RetentionTask} runs the last two periodically in small, throttled steps that yield the
 * event loop, keeps a watermark per policy in `server_config` so a pass only looks at what became
 * old since the previous one, and logs what it removed. `scripts/db-retention.ts` runs one pass
 * unthrottled against a stopped server's database for the one-off shrink (see the runbook linked in
 * hypermedia/app-environment/operations.md).
 *
 * Session transcripts (`session_events`) are never deleted here.
 */

import type {Database} from 'bun:sqlite'
import * as cbor from '@/cbor'
import * as durableSession from '@/durable-session'
import {log} from '@/log'
import {stmt} from '@/statements'

/** `on` removes, `report` only logs what it would remove, `off` does not run. */
export type RetentionMode = 'on' | 'report' | 'off'

/** What the periodic task removes, and how fast it may go. */
export type RetentionPolicy = {
  mode: RetentionMode
  /** A session idle this long loses its durable store (rebuilt on its next turn). Zero disables. */
  durableIdleMs: number
  /** A run finished this long ago has its journal's large payloads compacted. Zero disables. */
  journalAgeMs: number
  /** Bytes removed or rewritten per second, as a disk-load budget. Zero means unthrottled. */
  bytesPerSecond: number
  /**
   * A durable store is dropped in one transaction (a partially deleted store would be corrupt), so
   * one larger than this is left for an offline pass rather than blocking the server while it goes.
   * Infinity drops every store.
   */
  maxStoreBytes: number
  /** Time between passes. */
  intervalMs: number
  /** Time from start to the first pass, so a pass never competes with boot. */
  initialDelayMs: number
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  mode: 'on',
  durableIdleMs: 14 * 86_400_000,
  journalAgeMs: 30 * 86_400_000,
  bytesPerSecond: 2 * 1_048_576,
  maxStoreBytes: 32 * 1_048_576,
  intervalMs: 6 * 3_600_000,
  initialDelayMs: 15 * 60_000,
}

/** A journal entry stored larger than this is compacted once its run is old enough. */
export const JOURNAL_ENTRY_KEEP_BYTES = 16 * 1024
/** How much of a compacted string a journal entry keeps. */
const JOURNAL_PREVIEW_CHARS = 1024
/** The payload fields of a journal entry that are replaced by a preview when trimming strings is not enough. */
const JOURNAL_PAYLOAD_FIELDS = ['input', 'output', 'delivery', 'data', 'match'] as const

/** Live run statuses: a session with one of these may open its durable store at any moment. */
const LIVE_RUN_STATUSES = ['queued', 'claimed', 'running', 'waiting'] as const
const TERMINAL_RUN_STATUSES = ['succeeded', 'failed', 'canceled'] as const

/** Scan windows: candidates are looked up one day of timestamps at a time, so no query is unbounded. */
const WINDOW_MS = 86_400_000

const DURABLE_WATERMARK_KEY = 'retention.durable.watermark'
const JOURNAL_WATERMARK_KEY = 'retention.journal.watermark'

// ---------------------------------------------------------------------------------------------
// Tool output cap
// ---------------------------------------------------------------------------------------------

/** Default cap, in characters, on one string inside a stored tool output. */
export const DEFAULT_PERSISTED_STRING_CHARS = 128 * 1024

let persistedStringChars = DEFAULT_PERSISTED_STRING_CHARS

/** Sets the cap {@link boundPersistedToolOutput} applies (from config); zero turns it off. */
export function setPersistedToolOutputLimit(chars: number): void {
  persistedStringChars = chars
}

/** The current cap on one string inside a stored tool output; zero means none. */
export function persistedToolOutputLimit(): number {
  return persistedStringChars
}

/**
 * Bounds a tool output for storage: any string (or byte array) longer than the cap keeps its head
 * and gains a marker naming how much was cut. Everything else is returned as is, and an output
 * with nothing to cut is returned unchanged (same reference). Only what is stored for people to
 * inspect goes through this; workflow scripts and the model get their results elsewhere.
 */
export function boundPersistedToolOutput<T>(value: T, limit: number = persistedStringChars): T {
  if (!limit || limit <= 0) return value
  return boundStrings(value, limit, (length, kind) => `… [truncated for storage: ${length} ${kind} in total]`) as T
}

function boundStrings(value: unknown, limit: number, marker: (length: number, kind: string) => string): unknown {
  if (typeof value === 'string') {
    if (value.length <= limit) return value
    let head = value.slice(0, limit)
    const last = head.charCodeAt(head.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1)
    return `${head}${marker(value.length, 'chars')}`
  }
  if (value instanceof Uint8Array) {
    if (value.length <= limit) return value
    return marker(value.length, 'bytes')
  }
  if (Array.isArray(value)) {
    let out: unknown[] | undefined
    for (let i = 0; i < value.length; i++) {
      const next = boundStrings(value[i], limit, marker)
      if (next !== value[i] && !out) out = value.slice(0, i)
      if (out) out.push(next)
    }
    return out ?? value
  }
  if (value && typeof value === 'object') {
    let out: Record<string, unknown> | undefined
    for (const [key, entry] of Object.entries(value)) {
      const next = boundStrings(entry, limit, marker)
      if (next !== entry && !out) out = {...(value as Record<string, unknown>)}
      if (out) out[key] = next
    }
    return out ?? value
  }
  return value
}

// ---------------------------------------------------------------------------------------------
// Journal compaction
// ---------------------------------------------------------------------------------------------

/**
 * Cuts one journal entry of a finished run down to at most about {@link JOURNAL_ENTRY_KEEP_BYTES}:
 * first long strings become previews, then payload fields that are still too big become a preview
 * object, and as a last resort only the entry's identity (kind, callSeq, key, status, tool, error)
 * stays. The entry gains `compacted: {at, bytes}` with its original stored size.
 */
export function compactJournalEntry(entry: Record<string, unknown>, storedBytes: number, now: number) {
  const marker = (length: number, kind: string) => `… [compacted by retention: ${length} ${kind} in total]`
  let out = boundStrings(entry, JOURNAL_PREVIEW_CHARS, marker) as Record<string, unknown>
  const tooBig = (value: unknown) => cbor.encode(value).byteLength > JOURNAL_ENTRY_KEEP_BYTES
  if (tooBig(out)) {
    out = {...out}
    for (const field of JOURNAL_PAYLOAD_FIELDS) {
      if (!(field in out)) continue
      const encoded = safeJson(out[field])
      out[field] = {
        compacted: true,
        bytes: encoded.length,
        preview: encoded.slice(0, JOURNAL_PREVIEW_CHARS),
      }
    }
  }
  if (tooBig(out)) {
    const kept: Record<string, unknown> = {}
    for (const field of ['kind', 'callSeq', 'key', 'status', 'op', 'tool', 'childRunId', 'waitId', 'stepId', 'phase']) {
      if (field in out) kept[field] = out[field]
    }
    if (isRecord(out.error)) {
      kept.error = boundStrings(out.error, JOURNAL_PREVIEW_CHARS, marker)
    }
    out = kept
  }
  out.compacted = {at: now, bytes: storedBytes}
  return out
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------------------------

/** What one pass of one policy did (or, in report mode, would have done). */
export type RetentionTally = {
  /** Sessions whose stores were dropped, or runs whose journals were compacted. */
  items: number
  /** Rows deleted or rewritten. */
  rows: number
  /** Stored bytes removed (for a compaction, the size difference). */
  bytes: number
  /** Candidates left alone: a live run, an open store, or a store over `maxStoreBytes`. */
  skipped: number
  /** Bytes of the stores left for an offline pass because they exceed `maxStoreBytes`. */
  deferredBytes: number
}

const emptyTally = (): RetentionTally => ({items: 0, rows: 0, bytes: 0, skipped: 0, deferredBytes: 0})

/** Controls a pass from the outside: when to stop, and how to wait between steps. */
export type PassControl = {
  /** True once the pass must stop (the server is shutting down). */
  stopped?: () => boolean
  /** Waits between steps; the default sleeps. Tests pass a no-op. */
  pause?: (ms: number) => Promise<void>
  now?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Waits long enough that `bytes` of work stays within the budget, and always yields the loop. */
async function throttle(policy: RetentionPolicy, control: PassControl, bytes: number): Promise<void> {
  const pause = control.pause ?? sleep
  const ms = policy.bytesPerSecond > 0 ? Math.ceil((bytes / policy.bytesPerSecond) * 1000) : 0
  await pause(Math.max(ms, 1))
}

/**
 * Drops the durable store of every session idle since before `now - durableIdleMs` that has no live
 * run and whose store no turn holds open. Each store goes in one transaction: a partially deleted
 * store would fail to open, while an absent one is rebuilt from the log.
 */
export async function retireIdleDurableStores(
  db: Database,
  policy: RetentionPolicy,
  control: PassControl = {},
): Promise<RetentionTally> {
  const tally = emptyTally()
  if (policy.mode === 'off' || policy.durableIdleMs <= 0) return tally
  const now = control.now ?? Date.now()
  const cutoff = now - policy.durableIdleMs
  let from = readWatermark(db, DURABLE_WATERMARK_KEY)
  if (from === undefined) {
    from = stmt<{at: number | null}, []>(db, `SELECT MIN(updated_at) AS at FROM sessions`).get()?.at ?? cutoff
  }
  // Where the next pass starts: the oldest session this pass had to leave alone, or the cutoff.
  let hold: number | undefined
  for (let start = from; start < cutoff; start += WINDOW_MS) {
    if (control.stopped?.()) return tally
    const end = Math.min(start + WINDOW_MS, cutoff)
    const sessions = stmt<{id: string; updated_at: number}, [number, number]>(
      db,
      `SELECT id, updated_at FROM sessions WHERE updated_at >= ? AND updated_at < ?`,
    ).all(start, end)
    const windowTally = emptyTally()
    for (const session of sessions) {
      if (control.stopped?.()) return tally
      const store = stmt<{rows: number; bytes: number | null}, [string]>(
        db,
        `SELECT COUNT(*) AS rows, SUM(LENGTH(data)) AS bytes FROM session_durable_files WHERE session_id = ?`,
      ).get(session.id)
      if (!store || store.rows === 0) continue
      const bytes = store.bytes ?? 0
      const busy = () =>
        durableSession.isSessionStorageOpen(db, session.id) ||
        stmt(
          db,
          `SELECT 1 FROM runs WHERE session_id = ? AND status IN (${LIVE_RUN_STATUSES.map(() => '?').join(
            ', ',
          )}) LIMIT 1`,
        ).get(session.id, ...LIVE_RUN_STATUSES) !== null
      if (busy()) {
        windowTally.skipped += 1
        hold = Math.min(hold ?? session.updated_at, session.updated_at)
        continue
      }
      if (bytes > policy.maxStoreBytes) {
        windowTally.skipped += 1
        windowTally.deferredBytes += bytes
        continue
      }
      if (policy.mode === 'on') {
        // Synchronous from the check to the delete: no turn can open the store in between.
        const deleted = db.transaction(() => {
          if (busy()) return -1
          return stmt(db, `DELETE FROM session_durable_files WHERE session_id = ?`).run([session.id]).changes
        })()
        if (deleted < 0) {
          windowTally.skipped += 1
          hold = Math.min(hold ?? session.updated_at, session.updated_at)
          continue
        }
        windowTally.rows += deleted
      } else {
        windowTally.rows += store.rows
      }
      windowTally.items += 1
      windowTally.bytes += bytes
      await throttle(policy, control, bytes)
    }
    addTally(tally, windowTally)
    if (windowTally.items > 0 || windowTally.deferredBytes > 0) {
      log.info('[agents/retention] durable stores of idle sessions', {
        mode: policy.mode,
        window: new Date(start).toISOString().slice(0, 10),
        sessions: windowTally.items,
        rows: windowTally.rows,
        bytes: windowTally.bytes,
        skipped: windowTally.skipped,
        deferredBytes: windowTally.deferredBytes,
      })
    }
    if (policy.mode === 'on') writeWatermark(db, DURABLE_WATERMARK_KEY, Math.min(hold ?? end, end))
    await (control.pause ?? sleep)(1)
  }
  return tally
}

/**
 * Compacts the large journal entries of every run that finished before `now - journalAgeMs`. A
 * terminal run is never resumed, so its journal is only read by the run inspector; each entry is
 * rewritten on its own, so the work can stop and resume anywhere.
 */
export async function compactFinishedRunJournals(
  db: Database,
  policy: RetentionPolicy,
  control: PassControl = {},
): Promise<RetentionTally> {
  const tally = emptyTally()
  if (policy.mode === 'off' || policy.journalAgeMs <= 0) return tally
  const now = control.now ?? Date.now()
  const cutoff = now - policy.journalAgeMs
  let from = readWatermark(db, JOURNAL_WATERMARK_KEY)
  if (from === undefined) {
    from = stmt<{at: number | null}, []>(db, `SELECT MIN(created_at) AS at FROM runs`).get()?.at ?? cutoff
  }
  // Runs are found by creation time (indexed), but only a finished one is compacted; the oldest
  // run still live (or finished after the cutoff) holds the watermark so a later pass sees it again.
  let hold: number | undefined
  const terminal = TERMINAL_RUN_STATUSES.map(() => '?').join(', ')
  for (let start = from; start < cutoff; start += WINDOW_MS) {
    if (control.stopped?.()) return tally
    const end = Math.min(start + WINDOW_MS, cutoff)
    const candidates = stmt<
      {id: string; status: string; created_at: number; finished_at: number | null},
      [number, number]
    >(db, `SELECT id, status, created_at, finished_at FROM runs WHERE created_at >= ? AND created_at < ?`).all(
      start,
      end,
    )
    const windowTally = emptyTally()
    for (const run of candidates) {
      if (control.stopped?.()) return tally
      const finished =
        (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status) &&
        run.finished_at !== null &&
        run.finished_at < cutoff
      if (!finished) {
        hold = Math.min(hold ?? run.created_at, run.created_at)
        continue
      }
      const large = stmt<{seq: number; bytes: number}, [string, number]>(
        db,
        `SELECT seq, LENGTH(entry_cbor) AS bytes FROM run_journal WHERE run_id = ? AND LENGTH(entry_cbor) > ?`,
      ).all(run.id, JOURNAL_ENTRY_KEEP_BYTES)
      if (large.length === 0) continue
      let runSaved = 0
      for (const {seq, bytes} of large) {
        if (control.stopped?.()) return tally
        const row = stmt<{entry_cbor: Uint8Array}, [string, number]>(
          db,
          `SELECT entry_cbor FROM run_journal WHERE run_id = ? AND seq = ?`,
        ).get(run.id, seq)
        if (!row) continue
        let entry: unknown
        try {
          entry = cbor.decode(row.entry_cbor)
        } catch {
          continue
        }
        if (!isRecord(entry)) continue
        const compacted = cbor.encode(compactJournalEntry(entry, bytes, now))
        if (compacted.byteLength >= bytes) continue
        if (policy.mode === 'on') {
          stmt(
            db,
            `UPDATE run_journal SET entry_cbor = ? WHERE run_id = ? AND seq = ? AND run_id IN (
               SELECT id FROM runs WHERE id = ? AND status IN (${terminal}))`,
          ).run([compacted, run.id, seq, run.id, ...TERMINAL_RUN_STATUSES])
        }
        windowTally.rows += 1
        runSaved += bytes - compacted.byteLength
        await throttle(policy, control, bytes)
      }
      if (runSaved > 0) {
        windowTally.items += 1
        windowTally.bytes += runSaved
      }
    }
    addTally(tally, windowTally)
    if (windowTally.items > 0) {
      log.info('[agents/retention] compacted journals of finished runs', {
        mode: policy.mode,
        window: new Date(start).toISOString().slice(0, 10),
        runs: windowTally.items,
        entries: windowTally.rows,
        bytes: windowTally.bytes,
      })
    }
    if (policy.mode === 'on') writeWatermark(db, JOURNAL_WATERMARK_KEY, Math.min(hold ?? end, end))
    await (control.pause ?? sleep)(1)
  }
  return tally
}

/** One pass of every policy, in order. */
export async function runRetentionPass(
  db: Database,
  policy: RetentionPolicy,
  control: PassControl = {},
): Promise<{durable: RetentionTally; journal: RetentionTally}> {
  const started = Date.now()
  const durable = await retireIdleDurableStores(db, policy, control)
  const journal = await compactFinishedRunJournals(db, policy, control)
  log.info('[agents/retention] pass finished', {
    mode: policy.mode,
    elapsedMs: Date.now() - started,
    durableStores: durable.items,
    durableBytes: durable.bytes,
    durableSkipped: durable.skipped,
    durableDeferredBytes: durable.deferredBytes,
    journalRuns: journal.items,
    journalEntries: journal.rows,
    journalBytes: journal.bytes,
  })
  return {durable, journal}
}

function addTally(into: RetentionTally, from: RetentionTally): void {
  into.items += from.items
  into.rows += from.rows
  into.bytes += from.bytes
  into.skipped += from.skipped
  into.deferredBytes += from.deferredBytes
}

function readWatermark(db: Database, key: string): number | undefined {
  const row = stmt<{value: Uint8Array | string}, [string]>(db, `SELECT value FROM server_config WHERE key = ?`).get(key)
  if (!row) return undefined
  const text = typeof row.value === 'string' ? row.value : new TextDecoder().decode(row.value)
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

function writeWatermark(db: Database, key: string, value: number): void {
  stmt(
    db,
    `INSERT INTO server_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run([key, String(value)])
}

/**
 * Runs {@link runRetentionPass} on a timer: the first pass `initialDelayMs` after start, then every
 * `intervalMs`. One pass at a time; a pass that throws is logged and the next one runs on schedule.
 */
export class RetentionTask {
  #db: Database
  #policy: RetentionPolicy
  #timer: ReturnType<typeof setTimeout> | undefined
  #stopped = false
  #running: Promise<unknown> | undefined

  constructor(db: Database, policy: RetentionPolicy) {
    this.#db = db
    this.#policy = policy
  }

  start(): void {
    if (this.#policy.mode === 'off') {
      log.info('[agents/retention] off')
      return
    }
    log.info('[agents/retention] scheduled', {
      mode: this.#policy.mode,
      durableIdleDays: this.#policy.durableIdleMs / 86_400_000,
      journalAgeDays: this.#policy.journalAgeMs / 86_400_000,
      bytesPerSecond: this.#policy.bytesPerSecond,
      firstPassInMs: this.#policy.initialDelayMs,
    })
    this.#schedule(this.#policy.initialDelayMs)
  }

  /** Stops scheduling and asks a running pass to stop at its next step. */
  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    await this.#running?.catch(() => {})
  }

  #schedule(ms: number): void {
    if (this.#stopped) return
    this.#timer = setTimeout(() => {
      this.#running = runRetentionPass(this.#db, this.#policy, {stopped: () => this.#stopped})
        .catch((error) =>
          log.error('[agents/retention] pass failed', error instanceof Error ? error.message : String(error)),
        )
        .finally(() => {
          this.#running = undefined
          this.#schedule(this.#policy.intervalMs)
        })
    }, ms)
    this.#timer.unref?.()
  }
}
