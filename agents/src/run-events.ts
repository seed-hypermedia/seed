/**
 * Waiting runs, and what wakes them.
 *
 * A script that calls `ctx.waitForEvent(match)` parks its run and leaves one row here saying what
 * it is listening for. Two things can satisfy it: an activity-feed event the account is already
 * polling, or an explicit `SignalRun` from a person or another system. Either way the payload is
 * delivered into the run's journal and the run is requeued — exactly once, because the delivery and
 * the requeue happen in one SQLite transaction, so a signal that loses the race (to a timeout, a
 * cancellation, or another signal) writes nothing at all.
 *
 * These rows are transient run state, not configuration: they are created by a running script and
 * removed the moment the wait resolves, times out, or its run ends. That is why they live here and
 * not in `agent_triggers` — see the migration note in sqlite.ts.
 */
import type {Database} from 'bun:sqlite'
import * as cbor from '@/cbor'
import * as activityTriggers from '@/activity-triggers'

/**
 * What a parked run is listening for. Every field is optional and every present field must match,
 * so `{}` means "the next signal of any kind" and `{signal: 'approved'}` means exactly that one.
 */
export type RunEventMatch = {
  /** Name of an explicit SignalRun. When set, activity events never satisfy this wait. */
  signal?: string
  /** Activity feed event type, e.g. 'Comment' or 'Ref'. */
  eventType?: string
  /** Activity on this hm:// resource (compared canonically, ignoring version/query). */
  resource?: string
  /** Activity authored by this account uid. */
  author?: string
}

export type RunEventWaitRow = {
  runId: string
  waitId: string
  accountId: string
  match: RunEventMatch
  timeoutAt?: number
  createdAt: number
}

/** The payload handed to a woken run, journaled as the wait's result. */
export type RunEventDelivery = {
  source: 'signal' | 'activity' | 'trigger'
  /** Signal name, for signal deliveries. */
  signal?: string
  /** Whatever the signaller sent, or the matched activity event. */
  payload?: unknown
}

type Row = {
  run_id: string
  wait_id: string
  account_id: string
  match_cbor: Uint8Array
  timeout_at: number | null
  created_at: number
}

function rowToWait(row: Row): RunEventWaitRow {
  return {
    runId: row.run_id,
    waitId: row.wait_id,
    accountId: row.account_id,
    match: cbor.decode<RunEventMatch>(row.match_cbor),
    timeoutAt: row.timeout_at ?? undefined,
    createdAt: row.created_at,
  }
}

/** Registers (or refreshes) the wait a parked run is listening on. */
export function putRunEventWait(
  db: Database,
  wait: {runId: string; waitId: string; accountId: string; match: RunEventMatch; timeoutAt?: number},
): void {
  db.run(
    `INSERT INTO run_event_waits (run_id, wait_id, account_id, match_cbor, timeout_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, wait_id) DO UPDATE SET
       match_cbor = excluded.match_cbor, timeout_at = excluded.timeout_at`,
    [wait.runId, wait.waitId, wait.accountId, cbor.encode(wait.match), wait.timeoutAt ?? null, Date.now()],
  )
}

/** Every wait an account currently has open, oldest first. */
export function listAccountEventWaits(db: Database, accountId: string): RunEventWaitRow[] {
  return db
    .query<Row, [string]>(
      `SELECT run_id, wait_id, account_id, match_cbor, timeout_at, created_at
       FROM run_event_waits WHERE account_id = ? ORDER BY created_at ASC`,
    )
    .all(accountId)
    .map(rowToWait)
}

/** The waits one run has open (normally one; a script may await several at once). */
export function listRunEventWaits(db: Database, runId: string): RunEventWaitRow[] {
  return db
    .query<Row, [string]>(
      `SELECT run_id, wait_id, account_id, match_cbor, timeout_at, created_at
       FROM run_event_waits WHERE run_id = ? ORDER BY created_at ASC`,
    )
    .all(runId)
    .map(rowToWait)
}

/** Drops every wait a run holds — on delivery, timeout, cancellation, or the run simply ending. */
export function clearRunEventWaits(db: Database, runId: string): void {
  db.run(`DELETE FROM run_event_waits WHERE run_id = ?`, [runId])
}

/** True when an explicit signal satisfies this wait. */
export function signalMatchesWait(match: RunEventMatch, signal: string): boolean {
  // A wait that names activity criteria is about the feed, not about signals — but a wait with no
  // criteria at all is deliberately open, so any signal wakes it.
  if (match.signal !== undefined) return match.signal === signal
  return match.eventType === undefined && match.resource === undefined && match.author === undefined
}

/**
 * True when an activity-feed event satisfies this wait.
 *
 * The criteria themselves are matched by the shared matcher, so a wait and a trigger watching the
 * same document agree by construction rather than by two implementations happening to line up.
 */
export function activityMatchesWait(match: RunEventMatch, event: activityTriggers.ActivityFeedEvent): boolean {
  // A wait naming a signal is waiting for a person or a system, never for the feed.
  if (match.signal !== undefined) return false
  return activityTriggers.matchesActivityCriteria(match, event)
}
