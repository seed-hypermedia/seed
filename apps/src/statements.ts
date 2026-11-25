import type {Database, SQLQueryBindings, Statement} from 'bun:sqlite'
import {log} from '@/log'
import {recordPerf, recordPerfCount} from '@/perf'

// bun:sqlite runs on the server's only thread, so statement compilation is paid on the event loop.
// `Database.query()` looks cached but only remembers the first ~20 distinct SQL strings per
// Database; the codebase has several hundred, so nearly every call recompiled its statement (37%
// of main-thread samples in a 2026-09-09 production profile). `Database.prepare()` has no such
// cap, so this module memoizes prepared statements per Database keyed on the exact SQL string:
// each distinct statement is compiled once and reused for the life of the Database.
//
// Statements are not re-entrant: never iterate one (`.iterate()`) while running the same SQL
// inside the loop. `.get()`/`.all()`/`.run()` complete before returning, so those are safe.
// Bindings are sticky on a reused statement, so always pass every parameter on every call.
//
// Because every statement passes through here, this is also where SQLite time is measured. Each
// `.get/.all/.run/.values` call records `sql.<first keyword>` in the perf snapshot, and a call over
// {@link SLOW_STATEMENT_MS} logs its SQL (first 200 characters, never bindings) and duration at
// `warn`, rate-limited per statement, and counts `sql.slow`. A statement that blocks the only
// thread for tens of milliseconds is exactly what makes the server unresponsive, and before this
// log nothing named it without a profiler attached.

const caches = new WeakMap<Database, Map<string, Statement<unknown, any[]>>>()

/** A statement call longer than this (milliseconds) is logged as slow. */
export const SLOW_STATEMENT_MS = 20

/** At most this many slow-statement lines per statement per {@link SLOW_LOG_WINDOW_MS}. */
export const SLOW_LOG_LINES_PER_WINDOW = 3
export const SLOW_LOG_WINDOW_MS = 60_000

/** How much of the SQL text a slow-statement line carries. */
const SLOW_LOG_SQL_CHARS = 200

let slowThresholdMs = SLOW_STATEMENT_MS

/** Overrides the slow threshold (tests only), so a fast statement can exercise the slow path. */
export function setSlowStatementThresholdForTests(ms: number | undefined): void {
  slowThresholdMs = ms ?? SLOW_STATEMENT_MS
}

type SlowLogState = {windowStartedAt: number; lines: number; suppressed: number}
const slowLogs = new Map<string, SlowLogState>()

function firstKeyword(sql: string): string {
  const match = /^[\s(]*([A-Za-z]+)/.exec(sql)
  return match ? match[1]!.toLowerCase() : 'other'
}

function noteSlowStatement(sql: string, keyword: string, elapsedMs: number): void {
  recordPerfCount('sql.slow')
  const now = Date.now()
  let state = slowLogs.get(sql)
  if (!state || now - state.windowStartedAt >= SLOW_LOG_WINDOW_MS) {
    state = {windowStartedAt: now, lines: 0, suppressed: 0}
    slowLogs.set(sql, state)
  }
  if (state.lines >= SLOW_LOG_LINES_PER_WINDOW) {
    state.suppressed += 1
    return
  }
  state.lines += 1
  const suppressed = state.suppressed
  state.suppressed = 0
  log.warn('[agents/sql] slow statement', {
    ms: Math.round(elapsedMs * 10) / 10,
    keyword,
    sql: sql.length > SLOW_LOG_SQL_CHARS ? `${sql.slice(0, SLOW_LOG_SQL_CHARS)}…` : sql,
    ...(suppressed ? {suppressedSinceLastLine: suppressed} : {}),
  })
}

/**
 * Wraps the statement's synchronous verbs so each call is timed. Methods are replaced on the
 * instance (the native class keeps them on its prototype), so `finalize`, `columnNames`,
 * `iterate` and the rest are untouched and the statement stays the same object for the cache.
 */
function instrument(statement: Statement<unknown, any[]>, sql: string): void {
  const keyword = firstKeyword(sql)
  const metric = `sql.${keyword}`
  const timed = <Args extends unknown[], Result>(verb: (...args: Args) => Result): ((...args: Args) => Result) => {
    return function (this: unknown, ...args: Args): Result {
      const startedAt = performance.now()
      try {
        return verb.apply(this, args)
      } finally {
        const elapsed = performance.now() - startedAt
        recordPerf(metric, elapsed)
        if (elapsed > slowThresholdMs) noteSlowStatement(sql, keyword, elapsed)
      }
    }
  }
  statement.get = timed(statement.get)
  statement.all = timed(statement.all)
  statement.run = timed(statement.run)
  statement.values = timed(statement.values)
}

/** Returns the prepared statement for `sql` on `db`, compiling it on first use only. */
export function stmt<ReturnType = unknown, ParamsType extends SQLQueryBindings | SQLQueryBindings[] = any[]>(
  db: Database,
  sql: string,
): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]> {
  let cache = caches.get(db)
  if (!cache) {
    cache = new Map()
    caches.set(db, cache)
  }
  let statement = cache.get(sql)
  if (!statement) {
    statement = db.prepare(sql)
    instrument(statement, sql)
    cache.set(sql, statement)
  }
  return statement as Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>
}

/** Number of statements currently cached for `db` (diagnostics and tests). */
export function cachedStatementCount(db: Database): number {
  return caches.get(db)?.size ?? 0
}

/** Finalizes every cached statement for `db`. Call before `db.close()`. */
export function finalizeStatements(db: Database): void {
  const cache = caches.get(db)
  if (!cache) return
  caches.delete(db)
  for (const statement of cache.values()) {
    try {
      statement.finalize()
    } catch {
      // Already finalized (or the database is gone); nothing left to release.
    }
  }
}
