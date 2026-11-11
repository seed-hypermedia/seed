#!/usr/bin/env bun
/**
 * Estimates where an agents database's bytes are, without reading it all.
 *
 *   bun scripts/db-size-report.ts <path/to/agents.sqlite> [--samples 200] [--idle-days 14] [--journal-days 30]
 *
 * Read-only, and safe to run against a live production database: it opens the file read-only, never
 * scans a table, and never reads a blob's content. Everything is either a header pragma, a
 * `sqlite_stat1` row count, or a sample taken by index seeks, where `LENGTH(blob)` is answered from
 * the record header without loading overflow pages. A few thousand random page reads in total.
 *
 * Standalone (only bun:sqlite), so it can be copied into the container and run there. Wrap it in
 * `timeout` INSIDE the container so that losing the SSH session kills the query too:
 *
 *   docker cp db-size-report.ts agents-stable:/tmp/ &&
 *   docker exec agents-stable timeout 120 nice -n 19 bun /tmp/db-size-report.ts /data/agents.sqlite
 */

import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'

const args = process.argv.slice(2)
const dbPath = args.find((arg) => !arg.startsWith('--'))
if (!dbPath) {
  console.error('usage: bun db-size-report.ts <agents.sqlite> [--samples N] [--idle-days D] [--journal-days D]')
  process.exit(2)
}
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? Number(args[index + 1]) : fallback
}
const SAMPLES = option('samples', 200)
const IDLE_MS = option('idle-days', 14) * 86_400_000
const JOURNAL_MS = option('journal-days', 30) * 86_400_000
const now = Date.now()

const db = new Database(dbPath, {readonly: true})
const started = performance.now()
const mib = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MiB`
const gib = (bytes: number) => `${(bytes / 1_073_741_824).toFixed(2)} GiB`
const one = <T>(sql: string, ...params: (string | number)[]) => db.query(sql).get(...params) as T | null
const all = <T>(sql: string, ...params: (string | number)[]) => db.query(sql).all(...params) as T[]
const pragma = (name: string) => Number(Object.values(one<Record<string, unknown>>(`PRAGMA ${name}`) ?? {})[0])

// --- File and header ----------------------------------------------------------------------------
const pageSize = pragma('page_size')
const pageCount = pragma('page_count')
const freelist = pragma('freelist_count')
const fileSize = (path: string) => {
  try {
    return fs.statSync(path).size
  } catch {
    return 0
  }
}
console.log('== file')
console.log({
  db: gib(fileSize(dbPath)),
  wal: mib(fileSize(`${dbPath}-wal`)),
  pageSize,
  pageCount,
  freelistPages: freelist,
  freelist: gib(freelist * pageSize),
  autoVacuum: pragma('auto_vacuum'),
  journalMode: one<{journal_mode: string}>('PRAGMA journal_mode')?.journal_mode,
  sqlite: one<{v: string}>('SELECT sqlite_version() AS v')?.v,
  compileOptions: all<{compile_options: string}>('PRAGMA compile_options')
    .map((row) => row.compile_options)
    .filter((option) => /MMAP|DBSTAT|SYNCHRONOUS|CACHE_SIZE|DEFAULT_PAGE|SECURE_DELETE/.test(option)),
})

// --- Row counts from the planner statistics (refreshed at every boot for the small tables) ----------
console.log('\n== sqlite_stat1 row counts (tables analyzed at boot; blob tables are not)')
const stat = new Map<string, number>()
for (const row of all<{tbl: string; idx: string | null; stat: string}>('SELECT tbl, idx, stat FROM sqlite_stat1')) {
  const rows = Number(row.stat.split(' ')[0])
  stat.set(row.tbl, Math.max(stat.get(row.tbl) ?? 0, rows))
}
console.log(Object.fromEntries(stat))
const durableMaxRowid = one<{n: number | null}>('SELECT MAX(rowid) AS n FROM session_durable_files')?.n ?? 0
console.log({session_durable_files_maxRowid: durableMaxRowid})

// --- Sessions: durable store and transcript per session, split by idle -----------------------------
type SessionSample = {id: string; updated_at: number}
/** Picks up to `n` items uniformly at random. */
function pick<T>(items: T[], n: number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy.slice(0, n)
}
// Every session id, from a covering index (a few MB); the sample is uniform over sessions.
const allSessions = all<SessionSample>('SELECT id, updated_at FROM sessions INDEXED BY sessions_by_agent')
const sessionCount = allSessions.length
const sampledSessions = new Map(pick(allSessions, SAMPLES).map((session) => [session.id, session]))
const bucket = () => ({sessions: 0, durableRows: 0, durableBytes: 0, eventRows: 0, eventBytes: 0, maxEventBytes: 0})
const idle = bucket()
const active = bucket()
let maxDurable = {bytes: 0, id: ''}
for (const session of sampledSessions.values()) {
  const target = now - session.updated_at > IDLE_MS ? idle : active
  const durable = one<{rows: number; bytes: number | null}>(
    'SELECT COUNT(*) AS rows, SUM(LENGTH(data)) AS bytes FROM session_durable_files WHERE session_id = ?',
    session.id,
  )
  const events = one<{rows: number; bytes: number | null; max: number | null}>(
    'SELECT COUNT(*) AS rows, SUM(LENGTH(event_cbor)) AS bytes, MAX(LENGTH(event_cbor)) AS max FROM session_events WHERE session_id = ?',
    session.id,
  )
  target.sessions += 1
  target.durableRows += durable?.rows ?? 0
  target.durableBytes += durable?.bytes ?? 0
  target.eventRows += events?.rows ?? 0
  target.eventBytes += events?.bytes ?? 0
  target.maxEventBytes = Math.max(target.maxEventBytes, events?.max ?? 0)
  if ((durable?.bytes ?? 0) > maxDurable.bytes) maxDurable = {bytes: durable?.bytes ?? 0, id: session.id}
}
const extrapolate = (b: ReturnType<typeof bucket>) => {
  const n = sampledSessions.size || 1
  const scale = sessionCount / n
  return {
    sampled: b.sessions,
    estSessions: Math.round(b.sessions * scale),
    estDurable: gib(b.durableBytes * scale),
    estDurableRows: Math.round(b.durableRows * scale),
    estEvents: gib(b.eventBytes * scale),
    estEventRows: Math.round(b.eventRows * scale),
    maxEventInSample: mib(b.maxEventBytes),
  }
}
console.log(`\n== sessions (${sessionCount} total, ${sampledSessions.size} sampled)`)
console.log({[`idle > ${IDLE_MS / 86_400_000}d`]: extrapolate(idle), active: extrapolate(active)})
console.log({largestDurableStoreInSample: mib(maxDurable.bytes), session: maxDurable.id})

// --- Runs and their journals, split by finished age ---------------------------------------------------
// Every run id, from a covering index; then one primary-key lookup per sampled run.
const allRuns = all<{id: string}>('SELECT id FROM runs INDEXED BY runs_by_agent_status')
const runCount = allRuns.length
const sampledRuns = new Map<string, {id: string; status: string; kind: string; finished_at: number | null}>()
for (const {id} of pick(allRuns, SAMPLES)) {
  const row = one<{id: string; status: string; kind: string; finished_at: number | null}>(
    'SELECT id, status, kind, finished_at FROM runs WHERE id = ?',
    id,
  )
  if (row) sampledRuns.set(row.id, row)
}
const journalBucket = () => ({runs: 0, entries: 0, bytes: 0, largeBytes: 0, rowBytes: 0})
const journalOld = journalBucket()
const journalRecent = journalBucket()
const byKind: Record<string, number> = {}
for (const run of sampledRuns.values()) {
  const old =
    ['succeeded', 'failed', 'canceled'].includes(run.status) &&
    run.finished_at !== null &&
    now - run.finished_at > JOURNAL_MS
  const target = old ? journalOld : journalRecent
  const journal = one<{entries: number; bytes: number | null; large: number | null}>(
    'SELECT COUNT(*) AS entries, SUM(LENGTH(entry_cbor)) AS bytes, SUM(CASE WHEN LENGTH(entry_cbor) > 16384 THEN LENGTH(entry_cbor) ELSE 0 END) AS large FROM run_journal WHERE run_id = ?',
    run.id,
  )
  const row = one<{bytes: number | null}>(
    'SELECT COALESCE(LENGTH(input_cbor), 0) + COALESCE(LENGTH(output_cbor), 0) + COALESCE(LENGTH(error_cbor), 0) + COALESCE(LENGTH(wait_cbor), 0) + COALESCE(LENGTH(usage_cbor), 0) + COALESCE(LENGTH(plan_cbor), 0) AS bytes FROM runs WHERE id = ?',
    run.id,
  )
  target.runs += 1
  target.entries += journal?.entries ?? 0
  target.bytes += journal?.bytes ?? 0
  target.largeBytes += journal?.large ?? 0
  target.rowBytes += row?.bytes ?? 0
  byKind[run.kind] = (byKind[run.kind] ?? 0) + (journal?.bytes ?? 0)
}
const extrapolateRuns = (b: ReturnType<typeof journalBucket>) => {
  const scale = runCount / (sampledRuns.size || 1)
  return {
    sampled: b.runs,
    estRuns: Math.round(b.runs * scale),
    estJournal: gib(b.bytes * scale),
    estJournalInEntriesOver16KiB: gib(b.largeBytes * scale),
    estJournalEntries: Math.round(b.entries * scale),
    estRunRowBlobs: gib(b.rowBytes * scale),
  }
}
console.log(`\n== runs (${runCount} total, ${sampledRuns.size} sampled)`)
console.log({
  [`finished > ${JOURNAL_MS / 86_400_000}d ago`]: extrapolateRuns(journalOld),
  recentOrLive: extrapolateRuns(journalRecent),
  sampledJournalBytesByRunKind: Object.fromEntries(Object.entries(byKind).map(([kind, bytes]) => [kind, mib(bytes)])),
})

// --- Smaller tables with blobs: a handful of rows each -------------------------------------------------
const outbox = one<{n: number}>("SELECT COUNT(*) AS n FROM effect_outbox WHERE status = 'running'")
console.log('\n== other')
console.log({
  effectOutboxRunning: outbox?.n ?? 0,
  triggerFirings: stat.get('trigger_firings') ?? 'not analyzed',
})
console.log(`\ndone in ${Math.round(performance.now() - started)} ms`)
db.close()
