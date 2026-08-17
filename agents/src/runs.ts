/**
 * Durable run records and the dispatch queue.
 *
 * Every execution — an interactive agent turn, a trigger-fired turn, an agent-started background
 * session, a workflow — is a row in `runs`. Runs form a tree (`parent_run_id`, denormalized
 * `root_run_id`) and the table doubles as the dispatch queue: {@link RunQueue} claims `queued` rows
 * atomically under concurrency limits, executes them through per-kind executors registered by the
 * service, and finalizes their terminal status. Liveness is lease-based, so a crash never wedges a
 * session: {@link RunQueue.sweepAtBoot} requeues rows a dead process left `claimed`/`running`.
 */
import type {Database} from 'bun:sqlite'
import * as cbor from '@/cbor'

export type RunKind = 'agent' | 'workflow'
export type RunOrigin = 'user' | 'trigger' | 'agent' | 'workflow' | 'system'
export type RunStatus = 'queued' | 'claimed' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled'
export type RunQueueName = 'interactive' | 'background'

/** Structured terminal error stored on a failed run. */
export type RunErrorInfo = {
  code: string
  message: string
  retryable?: boolean
  /** HTTP status to surface when an interactive caller is waiting on this run. */
  httpStatus?: number
  /** Script stack for workflow errors; its `workflow.js:LINE` frames index into the stored source. */
  stack?: string
  /** Tool name of the failed call this error propagated from, when it was one. */
  tool?: string
  /** Journal callSeq of that failed call — joins the error to the call's args and result. */
  callSeq?: number
  /** Structured detail the failing tool attached, forwarded verbatim. */
  detail?: unknown
  /**
   * Obligations the run still owed when it failed (an undelivered typed result, an unfinished plan).
   * A succeeded run carries the same list on its output instead; either way the debt is visible.
   */
  unmetObligations?: Array<{kind: 'typed-result'} | {kind: 'plan'; steps: string[]}>
}

/**
 * Why a run is parked in `waiting` (holding no worker slot).
 *
 * `timer` and `event` both carry a wake time, which the queue writes to `not_before` so one sweep
 * wakes either kind; an `event` wait ALSO has a row in run_event_waits saying what would satisfy
 * it early. `budget-pause` has no wake time at all: only a person resumes it.
 */
export type RunWait =
  | {reason: 'children'; toolCallIds: string[]}
  | {reason: 'timer'; wakeAt: number}
  | {reason: 'event'; waitId: string; timeoutAt?: number; label?: string; answerWith?: string}
  | {reason: 'budget-pause'; note?: string}

export type RunBudget = {maxWallMs?: number; maxChildren?: number; maxDepth?: number}

/** Cumulative token usage persisted on a run (plus rolled-up child usage). */
export type RunUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  /** Aggregate usage of finished child runs, rolled up when each child finalizes. */
  children?: {input: number; output: number; cacheRead: number; cacheWrite: number; total: number; runs: number}
}

/** Step list snapshot rendered by the pinned run card. */
export type RunPlanStepState = {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  /** Set when the runtime closed the step from completed sub-agents. See `RunPlanStep.resolvedBy`. */
  resolvedBy?: 'runtime'
}

export type RunPlanState = {
  title?: string
  steps: RunPlanStepState[]
  /** Session-owning run that published this plan; absent on workflow-local plans and legacy rows. */
  ownerRunId?: string
  /** When every step last became terminal; cleared if an edit reopens one. See `RunPlan.settledAt`. */
  settledAt?: number
}

export type RunRecord = {
  id: string
  accountId: string
  rootRunId: string
  parentRunId?: string
  /** The parent's tool call this run was spawned by, when a tool call spawned it. */
  parentToolCallId?: string
  /** The run this one continues (ctx.continueAsNew): same work, fresh journal. */
  continuedFromRunId?: string
  depth: number
  kind: RunKind
  agentId?: string
  sessionId?: string
  triggerFiringId?: string
  origin: RunOrigin
  /** Every run is created with a real human-readable title; the display layer never invents one. */
  title: string
  model?: string
  sourceCid?: string
  sourceText?: string
  input: unknown
  output?: unknown
  error?: RunErrorInfo
  status: RunStatus
  wait?: RunWait
  attempt: number
  maxAttempts: number
  notBefore?: number
  queue: RunQueueName
  budget?: RunBudget
  usage?: RunUsage
  plan?: RunPlanState
  createdAt: number
  startedAt?: number
  finishedAt?: number
  updatedAt: number
}

/** What an executor reports back for a claimed run. */
export type RunOutcome =
  | {type: 'succeeded'; output: unknown}
  | {type: 'failed'; error: RunErrorInfo}
  | {type: 'canceled'; output?: unknown}
  | {type: 'parked'; wait: RunWait}

export type RunExecutor = (run: RunRecord) => Promise<RunOutcome>

export type EnqueueRunSpec = {
  /** Deterministic id for exactly-once enqueue (e.g. derived from a trigger firing); random when omitted. */
  id?: string
  accountId: string
  kind: RunKind
  origin: RunOrigin
  parentRunId?: string
  /**
   * The parent's tool call this run answers, persisted as a column so the row can be found by it.
   * The executors read the same id from `input`; this is its queryable projection.
   */
  parentToolCallId?: string
  /** Set when this run continues another (ctx.continueAsNew); see RunRecord.continuedFromRunId. */
  continuedFromRunId?: string
  /** Root/depth are derived from the parent when given; both default to a self-rooted depth-0 run. */
  agentId?: string
  sessionId?: string
  triggerFiringId?: string
  /** Required: callers derive a real title (message excerpt, brief, workflow name) at creation. */
  title: string
  model?: string
  sourceCid?: string
  sourceText?: string
  input: unknown
  queue: RunQueueName
  maxAttempts?: number
  budget?: RunBudget
  notBefore?: number
  /**
   * When false the dispatch loop is not woken: the caller claims the run itself via
   * {@link RunQueue.runInline} (interactive turns). The row still recovers through the loop after a
   * crash because the boot sweep leaves it queued.
   */
  dispatch?: boolean
}

const RETRY_BASE_MS = 5_000
const RETRY_CAP_MS = 5 * 60_000
const LEASE_MS = 60_000
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'canceled']
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'claimed', 'running', 'waiting']

type RunRow = {
  id: string
  account_id: string
  root_run_id: string
  parent_run_id: string | null
  parent_tool_call_id: string | null
  continued_from_run_id: string | null
  depth: number
  kind: string
  agent_id: string | null
  session_id: string | null
  trigger_firing_id: string | null
  origin: string
  title: string | null
  model: string | null
  source_cid: string | null
  source_text: string | null
  input_cbor: Uint8Array
  output_cbor: Uint8Array | null
  error_cbor: Uint8Array | null
  status: string
  wait_cbor: Uint8Array | null
  attempt: number
  max_attempts: number
  not_before: number | null
  queue: string
  lease_owner: string | null
  lease_expires_at: number | null
  budget_cbor: Uint8Array | null
  usage_cbor: Uint8Array | null
  plan_cbor: Uint8Array | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  updated_at: number
}

const RUN_COLUMNS = `id, account_id, root_run_id, parent_run_id, parent_tool_call_id, continued_from_run_id, depth, kind, agent_id, session_id,
  trigger_firing_id, origin, title, model, source_cid, source_text, input_cbor, output_cbor, error_cbor,
  status, wait_cbor, attempt, max_attempts, not_before, queue, lease_owner, lease_expires_at,
  budget_cbor, usage_cbor, plan_cbor, created_at, started_at, finished_at, updated_at`

/**
 * When the queue should wake a parked run on its own. Timers and event timeouts both land in
 * `not_before` so one sweep covers both; children and budget pauses are woken by something else
 * happening (a child finishing, a person resuming), never by the clock.
 */
function parkWakeAt(wait: RunWait): number | null {
  if (wait.reason === 'timer') return wait.wakeAt
  if (wait.reason === 'event') return wait.timeoutAt ?? null
  return null
}

function decodeMaybe<T>(bytes: Uint8Array | null): T | undefined {
  if (!bytes) return undefined
  return cbor.decode<T>(bytes)
}

export function rowToRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    rootRunId: row.root_run_id,
    parentRunId: row.parent_run_id ?? undefined,
    parentToolCallId: row.parent_tool_call_id ?? undefined,
    continuedFromRunId: row.continued_from_run_id ?? undefined,
    depth: row.depth,
    kind: row.kind as RunKind,
    agentId: row.agent_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    triggerFiringId: row.trigger_firing_id ?? undefined,
    origin: row.origin as RunOrigin,
    // NOT NULL in practice: enqueue validates it and a migration backfilled pre-requirement rows.
    title: row.title ?? 'Untitled run',
    model: row.model ?? undefined,
    sourceCid: row.source_cid ?? undefined,
    sourceText: row.source_text ?? undefined,
    input: cbor.decode(row.input_cbor),
    output: decodeMaybe(row.output_cbor),
    error: decodeMaybe<RunErrorInfo>(row.error_cbor),
    status: row.status as RunStatus,
    wait: decodeMaybe<RunWait>(row.wait_cbor),
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    notBefore: row.not_before ?? undefined,
    queue: row.queue as RunQueueName,
    budget: decodeMaybe<RunBudget>(row.budget_cbor),
    usage: decodeMaybe<RunUsage>(row.usage_cbor),
    plan: decodeMaybe<RunPlanState>(row.plan_cbor),
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    updatedAt: row.updated_at,
  }
}

export function getRun(db: Database, accountId: string, runId: string): RunRecord | null {
  const row = db
    .query<RunRow, [string, string]>(`SELECT ${RUN_COLUMNS} FROM runs WHERE account_id = ? AND id = ?`)
    .get(accountId, runId)
  return row ? rowToRun(row) : null
}

/** All runs in a root's tree, oldest first. */
export function listRunTree(db: Database, accountId: string, rootRunId: string): RunRecord[] {
  return db
    .query<RunRow, [string, string]>(
      `SELECT ${RUN_COLUMNS} FROM runs WHERE account_id = ? AND root_run_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(accountId, rootRunId)
    .map(rowToRun)
}

/** Root runs referencing a session, newest first. */
export function listSessionRootRuns(db: Database, accountId: string, sessionId: string, limit: number): RunRecord[] {
  return db
    .query<RunRow, [string, string, number]>(
      `SELECT ${RUN_COLUMNS} FROM runs
       WHERE account_id = ? AND session_id = ? AND id = root_run_id
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(accountId, sessionId, limit)
    .map(rowToRun)
}

/**
 * True when an agent run is actively executing or about to (queued/claimed/running). A `waiting`
 * run — parked on sub-sessions — deliberately does NOT count: a parked parent still converses,
 * and new interactive turns interleave with it (its resume queues behind them).
 */
export function sessionHasLiveRun(db: Database, sessionId: string): boolean {
  return (
    db
      .query<{id: string}, [string]>(
        `SELECT id FROM runs WHERE session_id = ? AND kind = 'agent'
         AND status IN ('queued','claimed','running') LIMIT 1`,
      )
      .get(sessionId) !== null
  )
}

/** Pending child tool-call ids across every waiting run of a session (still-running spawns). */
export function pendingWaitToolCallIds(db: Database, sessionId: string): Set<string> {
  const pending = new Set<string>()
  const rows = db
    .query<{wait_cbor: Uint8Array | null}, [string]>(
      `SELECT wait_cbor FROM runs WHERE session_id = ? AND status = 'waiting'`,
    )
    .all(sessionId)
  for (const row of rows) {
    if (!row.wait_cbor) continue
    const wait = cbor.decode<RunWait>(row.wait_cbor)
    if (wait.reason === 'children') for (const id of wait.toolCallIds) pending.add(id)
  }
  return pending
}

/** Non-terminal runs referencing a session (stop/cancel targets). */
export function listLiveSessionRuns(db: Database, accountId: string, sessionId: string): RunRecord[] {
  return db
    .query<RunRow, [string, string]>(
      `SELECT ${RUN_COLUMNS} FROM runs WHERE account_id = ? AND session_id = ?
       AND status IN ('queued', 'claimed', 'running', 'waiting') ORDER BY created_at ASC`,
    )
    .all(accountId, sessionId)
    .map(rowToRun)
}

/** Runs of one agent, newest first. */
export function listAgentRuns(db: Database, accountId: string, agentId: string, limit: number): RunRecord[] {
  return db
    .query<RunRow, [string, string, number]>(
      `SELECT ${RUN_COLUMNS} FROM runs WHERE account_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(accountId, agentId, limit)
    .map(rowToRun)
}

/** Latest run referencing the session (for deriving the legacy status mirror). */
export function latestSessionRun(db: Database, sessionId: string): RunRecord | null {
  const row = db
    .query<RunRow, [string]>(
      `SELECT ${RUN_COLUMNS} FROM runs WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(sessionId)
  return row ? rowToRun(row) : null
}

export class RunQueue {
  readonly #db: Database
  readonly #instanceId: string
  readonly #executors: Partial<Record<RunKind, RunExecutor>>
  readonly #onRunChanged?: (run: RunRecord) => void
  readonly #onRunFinalized?: (run: RunRecord) => void
  readonly #abortRun?: (run: RunRecord) => void
  readonly #maxConcurrentModelRuns: number
  readonly #maxConcurrentWorkflows: number
  readonly #retryBaseMs: number
  readonly #pollIntervalMs: number
  readonly #inflight = new Map<string, Promise<void>>()
  readonly #inflightKinds = new Map<string, RunKind>()
  #interval: ReturnType<typeof setInterval> | null = null
  #wakeTimer: ReturnType<typeof setTimeout> | null = null
  #idleWaiters: Array<() => void> = []

  constructor(
    db: Database,
    opts: {
      instanceId?: string
      executors: Partial<Record<RunKind, RunExecutor>>
      /** Fired on every status/usage transition, including non-terminal ones. */
      onRunChanged?: (run: RunRecord) => void
      /** Fired once per run after its terminal status committed (parent resolution hook). */
      onRunFinalized?: (run: RunRecord) => void
      /** Asked to abort a currently-executing run during cancellation. */
      abortRun?: (run: RunRecord) => void
      maxConcurrentModelRuns?: number
      /** Workflow runs hold no provider stream and get their own, higher cap. */
      maxConcurrentWorkflows?: number
      /** Retry backoff base (tests use small values). */
      retryBaseMs?: number
      /** Dispatch interval for backoff/timer wakes (tests use small values). */
      pollIntervalMs?: number
    },
  ) {
    this.#db = db
    this.#instanceId = opts.instanceId ?? crypto.randomUUID()
    this.#executors = opts.executors
    this.#onRunChanged = opts.onRunChanged
    this.#onRunFinalized = opts.onRunFinalized
    this.#abortRun = opts.abortRun
    this.#maxConcurrentModelRuns = opts.maxConcurrentModelRuns ?? 8
    this.#maxConcurrentWorkflows = opts.maxConcurrentWorkflows ?? 32
    this.#retryBaseMs = opts.retryBaseMs ?? RETRY_BASE_MS
    this.#pollIntervalMs = opts.pollIntervalMs ?? 1_000
  }

  /**
   * Requeues runs a previous process left claimed/running (a crash is not the run's fault: the
   * attempt counter is preserved as-is because claim increments it). Returns the number requeued.
   */
  sweepAtBoot(): number {
    const now = Date.now()
    const swept = this.#db
      .query<{id: string}, [number]>(
        `UPDATE runs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE status IN ('claimed', 'running') RETURNING id`,
      )
      .all(now)
    if (swept.length > 0) {
      console.info('[agents/runs] boot sweep requeued interrupted runs', {count: swept.length})
    }
    // Queued work may predate this boot (crash before dispatch, backoff timers): always resume it.
    if (this.#hasFutureWork()) this.wake()
    return swept.length
  }

  enqueue(spec: EnqueueRunSpec): RunRecord {
    const title = spec.title.trim()
    if (!title) throw new Error('Run title is required')
    const now = Date.now()
    const id = spec.id ?? crypto.randomUUID()
    let rootRunId = id
    let depth = 0
    if (spec.parentRunId) {
      const parent = this.#db
        .query<{root_run_id: string; depth: number}, [string]>(`SELECT root_run_id, depth FROM runs WHERE id = ?`)
        .get(spec.parentRunId)
      if (!parent) throw new Error(`Parent run not found: ${spec.parentRunId}`)
      rootRunId = parent.root_run_id
      depth = parent.depth + 1
    }
    this.#db.run(
      `INSERT INTO runs (id, account_id, root_run_id, parent_run_id, parent_tool_call_id, continued_from_run_id,
         depth, kind, agent_id, session_id, trigger_firing_id, origin, title, model, source_cid, source_text,
         input_cbor, status, attempt, max_attempts, not_before, queue, budget_cbor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        spec.accountId,
        rootRunId,
        spec.parentRunId ?? null,
        spec.parentToolCallId ?? null,
        spec.continuedFromRunId ?? null,
        depth,
        spec.kind,
        spec.agentId ?? null,
        spec.sessionId ?? null,
        spec.triggerFiringId ?? null,
        spec.origin,
        title,
        spec.model ?? null,
        spec.sourceCid ?? null,
        spec.sourceText ?? null,
        cbor.encode(spec.input ?? {}),
        spec.maxAttempts ?? 1,
        spec.notBefore ?? null,
        spec.queue,
        spec.budget ? cbor.encode(spec.budget) : null,
        now,
        now,
      ],
    )
    const run = this.#getRunAnyAccount(id)
    if (!run) throw new Error(`Run insert failed: ${id}`)
    this.#onRunChanged?.(run)
    if (spec.dispatch !== false) this.wake()
    return run
  }

  /**
   * Claims one specific queued run and executes it to completion on the caller's stack. Used by the
   * interactive path so `MessageSession` keeps its await-the-answer semantics; the run still goes
   * through the same claim/finalize machinery as loop-dispatched runs.
   */
  async runInline(runId: string): Promise<RunRecord> {
    const claimed = this.#claimSpecific(runId)
    if (claimed) await this.#execute(claimed)
    const run = this.#getRunAnyAccount(runId)
    if (!run) throw new Error(`Run not found after inline execution: ${runId}`)
    // The run may have parked; an inline caller treats that as final for the request.
    return run
  }

  /** Moves a waiting run back to queued (child resolution / timer wake). */
  requeueWaiting(runId: string, opts: {notBefore?: number} = {}): RunRecord | null {
    const now = Date.now()
    const row = this.#db
      .query<RunRow, [number | null, number, string]>(
        `UPDATE runs SET status = 'queued', wait_cbor = NULL, not_before = ?, updated_at = ?
         WHERE id = ? AND status = 'waiting' RETURNING ${RUN_COLUMNS}`,
      )
      .get(opts.notBefore ?? null, now, runId)
    if (!row) return null
    this.#clearEventWaits(runId)
    const run = rowToRun(row)
    this.#onRunChanged?.(run)
    this.wake()
    return run
  }

  /**
   * Lets a budget-paused run keep going, because a person said so.
   *
   * The wall-clock budget that stopped it is dropped rather than extended: the run would otherwise
   * park again on its very next tick, and "resume" that resumes nothing is worse than no button.
   * Every other budget dimension stays in force.
   */
  resumeBudgetPause(runId: string): RunRecord | null {
    const current = this.#getRunAnyAccount(runId)
    if (!current || current.status !== 'waiting' || current.wait?.reason !== 'budget-pause') return null
    if (current.budget) {
      const {maxWallMs: _dropped, ...rest} = current.budget
      this.#db.run(`UPDATE runs SET budget_cbor = ?, updated_at = ? WHERE id = ?`, [
        cbor.encode(rest),
        Date.now(),
        runId,
      ])
    }
    return this.requeueWaiting(runId)
  }

  /**
   * Marks one pending child tool call of a parked parent resolved. Requeues the parent when the
   * last one resolves; otherwise persists the shrunken wait set. Returns what happened so callers
   * can log/react; `not-waiting` covers parents that have not parked yet (the post-park reconcile
   * pass closes that race).
   */
  resolveChildWait(parentRunId: string, toolCallId: string): 'requeued' | 'updated' | 'not-waiting' {
    const parent = this.#getRunAnyAccount(parentRunId)
    if (!parent || parent.status !== 'waiting' || parent.wait?.reason !== 'children') return 'not-waiting'
    const remaining = parent.wait.toolCallIds.filter((id) => id !== toolCallId)
    if (remaining.length === parent.wait.toolCallIds.length) return 'not-waiting'
    if (remaining.length === 0) {
      this.requeueWaiting(parentRunId)
      return 'requeued'
    }
    const row = this.#db
      .query<RunRow, [Uint8Array, number, string]>(
        `UPDATE runs SET wait_cbor = ?, updated_at = ? WHERE id = ? AND status = 'waiting' RETURNING ${RUN_COLUMNS}`,
      )
      .get(cbor.encode({reason: 'children', toolCallIds: remaining} satisfies RunWait), Date.now(), parentRunId)
    if (row) this.#onRunChanged?.(rowToRun(row))
    return 'updated'
  }

  /**
   * Cancels a run and every non-terminal descendant. Queued runs never start; waiting runs never
   * wake; executing runs are aborted through the service callback and finalize as canceled.
   */
  cancelTree(accountId: string, runId: string): RunRecord[] {
    const root = getRun(this.#db, accountId, runId)
    if (!root) return []
    const now = Date.now()
    const rows = this.#db
      .query<RunRow, [number, string, string]>(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM runs WHERE id = ?2
           UNION ALL
           SELECT r.id FROM runs r JOIN tree t ON r.parent_run_id = t.id
         )
         UPDATE runs SET status = 'canceled', wait_cbor = NULL, finished_at = ?1, updated_at = ?1
         WHERE id IN (SELECT id FROM tree) AND account_id = ?3
           AND status IN ('queued', 'waiting') RETURNING ${RUN_COLUMNS}`,
      )
      .all(now, runId, accountId)
    const canceled = rows.map(rowToRun)
    for (const run of canceled) {
      this.#clearEventWaits(run.id)
      this.#onRunChanged?.(run)
      this.#onRunFinalized?.(run)
    }
    // Claimed/running members finalize as canceled through their own executor teardown.
    const live = this.#db
      .query<RunRow, [string, string]>(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM runs WHERE id = ?1
           UNION ALL
           SELECT r.id FROM runs r JOIN tree t ON r.parent_run_id = t.id
         )
         SELECT ${RUN_COLUMNS} FROM runs WHERE id IN (SELECT id FROM tree) AND account_id = ?2
           AND status IN ('claimed', 'running')`,
      )
      .all(runId, accountId)
      .map(rowToRun)
    for (const run of live) this.#abortRun?.(run)
    return [...canceled, ...live]
  }

  /** Cancels queued/waiting runs referencing a session (StopSession companion to the live abort). */
  cancelQueuedForSession(accountId: string, sessionId: string): RunRecord[] {
    const now = Date.now()
    const rows = this.#db
      .query<RunRow, [number, string, string]>(
        `UPDATE runs SET status = 'canceled', wait_cbor = NULL, finished_at = ?1, updated_at = ?1
         WHERE account_id = ?2 AND session_id = ?3 AND status IN ('queued', 'waiting')
         RETURNING ${RUN_COLUMNS}`,
      )
      .all(now, accountId, sessionId)
    const canceled = rows.map(rowToRun)
    for (const run of canceled) {
      this.#clearEventWaits(run.id)
      this.#onRunChanged?.(run)
      this.#onRunFinalized?.(run)
    }
    return canceled
  }

  /** Nudges the dispatch loop; safe to call from anywhere, including inside transactions. */
  wake(): void {
    if (this.#wakeTimer) return
    this.#wakeTimer = setTimeout(() => {
      this.#wakeTimer = null
      this.#pump()
    }, 0)
    this.#ensureInterval()
  }

  /** Resolves when no runs are queued, claimed, running, or executing in this process. */
  async awaitIdle(): Promise<void> {
    for (;;) {
      if (
        this.#inflight.size === 0 &&
        !this.#hasDispatchableWork() &&
        !this.#hasPendingRetry() &&
        this.#wakeTimer === null
      ) {
        return
      }
      await Promise.allSettled([...this.#inflight.values()])
      await new Promise<void>((resolve) => {
        this.#idleWaiters.push(resolve)
        // Re-check quickly rather than waiting for a pump that may never signal.
        setTimeout(resolve, 10)
      })
    }
  }

  stop(): void {
    if (this.#interval) clearInterval(this.#interval)
    this.#interval = null
    if (this.#wakeTimer) clearTimeout(this.#wakeTimer)
    this.#wakeTimer = null
  }

  /** Persists the in-flight usage snapshot for a run (cheap single-row update; no event emitted). */
  updateUsage(runId: string, usage: RunUsage): void {
    this.#db.run(`UPDATE runs SET usage_cbor = ?, updated_at = ? WHERE id = ?`, [cbor.encode(usage), Date.now(), runId])
  }

  /** Persists the plan/step snapshot for a run and notifies subscribers. */
  updatePlan(runId: string, plan: RunPlanState): RunRecord | null {
    const row = this.#db
      .query<RunRow, [Uint8Array, number, string]>(
        `UPDATE runs SET plan_cbor = ?, updated_at = ? WHERE id = ? RETURNING ${RUN_COLUMNS}`,
      )
      .get(cbor.encode(plan), Date.now(), runId)
    if (!row) return null
    const run = rowToRun(row)
    this.#onRunChanged?.(run)
    return run
  }

  #getRunAnyAccount(runId: string): RunRecord | null {
    const row = this.#db.query<RunRow, [string]>(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(runId)
    return row ? rowToRun(row) : null
  }

  #hasDispatchableWork(): boolean {
    const now = Date.now()
    return (
      this.#db
        .query<{id: string}, [number]>(
          `SELECT id FROM runs WHERE status = 'queued' AND (not_before IS NULL OR not_before <= ?) LIMIT 1`,
        )
        .get(now) !== null
    )
  }

  /**
   * A run waiting out a retry backoff: queued, but not yet dispatchable.
   *
   * It is invisible to {@link RunQueue.#hasDispatchableWork} until its `not_before` passes, so
   * without this the queue reads as idle mid-retry — a drain would return while a run is still
   * going to execute. Bounded by RETRY_CAP_MS, unlike `waiting` runs (durable sleeps can be days),
   * which is why only this narrow case belongs in the idle condition.
   */
  #hasPendingRetry(): boolean {
    return (
      this.#db
        .query<{id: string}, [number]>(
          `SELECT id FROM runs WHERE status = 'queued' AND not_before IS NOT NULL AND not_before > ? LIMIT 1`,
        )
        .get(Date.now()) !== null
    )
  }

  #hasFutureWork(): boolean {
    return (
      this.#db
        .query<{id: string}, []>(
          `SELECT id FROM runs WHERE status = 'queued'
             OR (status = 'waiting' AND not_before IS NOT NULL) LIMIT 1`,
        )
        .get() !== null
    )
  }

  #ensureInterval(): void {
    if (this.#interval) return
    this.#interval = setInterval(() => this.#pump(), this.#pollIntervalMs)
  }

  #maybeStopInterval(): void {
    if (!this.#interval) return
    if (this.#inflight.size > 0 || this.#hasFutureWork()) return
    clearInterval(this.#interval)
    this.#interval = null
  }

  #pump(): void {
    try {
      this.#wakeDueTimers()
      for (;;) {
        const kinds: RunKind[] = []
        let agentInflight = 0
        let workflowInflight = 0
        for (const kind of this.#inflightKinds.values()) {
          if (kind === 'agent') agentInflight += 1
          else workflowInflight += 1
        }
        if (agentInflight < this.#maxConcurrentModelRuns) kinds.push('agent')
        if (workflowInflight < this.#maxConcurrentWorkflows) kinds.push('workflow')
        if (kinds.length === 0) break
        const run = this.#claimNext(kinds)
        if (!run) break
        const done = this.#execute(run).finally(() => {
          this.#inflight.delete(run.id)
          this.#inflightKinds.delete(run.id)
          const waiters = this.#idleWaiters
          this.#idleWaiters = []
          for (const waiter of waiters) waiter()
          this.#pump()
        })
        this.#inflight.set(run.id, done)
        this.#inflightKinds.set(run.id, run.kind)
      }
      this.#maybeStopInterval()
    } catch (error) {
      // A closed database means the service is being torn down (tests, shutdown): stop timers.
      if (error instanceof RangeError && String(error.message).includes('closed database')) {
        this.stop()
        return
      }
      console.error('[agents/runs] dispatch pump failed', error instanceof Error ? error.message : String(error))
    }
  }

  #claimNext(kinds: RunKind[]): RunRecord | null {
    if (kinds.length === 0) return null
    const now = Date.now()
    const kindList = kinds.map((kind) => `'${kind}'`).join(', ')
    const row = this.#db
      .query<RunRow, [string, number, number, number]>(
        `UPDATE runs SET status = 'claimed', lease_owner = ?1, lease_expires_at = ?2, attempt = attempt + 1, updated_at = ?3
         WHERE id = (
           SELECT r.id FROM runs r
           WHERE r.status = 'queued' AND (r.not_before IS NULL OR r.not_before <= ?4)
             AND r.kind IN (${kindList})
             AND NOT (
               r.kind = 'agent' AND r.session_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM runs r2 WHERE r2.session_id = r.session_id AND r2.id != r.id
                   AND r2.status IN ('claimed', 'running')
               )
             )
           ORDER BY CASE r.queue WHEN 'interactive' THEN 0 ELSE 1 END, r.created_at, r.id
           LIMIT 1
         )
         RETURNING ${RUN_COLUMNS}`,
      )
      .get(this.#instanceId, now + LEASE_MS, now, now)
    return row ? rowToRun(row) : null
  }

  /**
   * Parked runs whose wake time arrived move back to queued — a plain sleep, or an event wait that
   * ran out of patience. The wait rows go with it: the run will re-register them if it parks again,
   * and a stale row would deliver into a run that is no longer listening.
   */
  #wakeDueTimers(): void {
    const now = Date.now()
    const rows = this.#db
      .query<RunRow, [number, number]>(
        `UPDATE runs SET status = 'queued', wait_cbor = NULL, not_before = NULL, updated_at = ?1
         WHERE status = 'waiting' AND not_before IS NOT NULL AND not_before <= ?2 RETURNING ${RUN_COLUMNS}`,
      )
      .all(now, now)
    for (const row of rows) {
      this.#clearEventWaits(row.id)
      this.#onRunChanged?.(rowToRun(row))
    }
  }

  /** Forgets what a run was listening for; safe to call for runs that were never listening. */
  #clearEventWaits(runId: string): void {
    this.#db.run(`DELETE FROM run_event_waits WHERE run_id = ?`, [runId])
  }

  #claimSpecific(runId: string): RunRecord | null {
    const now = Date.now()
    // Same-session exclusion mirrors #claimNext: the interactive path must not start a second
    // executor on a session another live run owns (guard TOCTOU upstream is not sufficient).
    const row = this.#db
      .query<RunRow, [string, number, number, string]>(
        `UPDATE runs SET status = 'claimed', lease_owner = ?1, lease_expires_at = ?2, attempt = attempt + 1, updated_at = ?3
         WHERE id = ?4 AND status = 'queued'
           AND NOT (
             kind = 'agent' AND session_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM runs r2 WHERE r2.session_id = runs.session_id AND r2.id != runs.id
                 AND r2.status IN ('claimed', 'running')
             )
           )
         RETURNING ${RUN_COLUMNS}`,
      )
      .get(this.#instanceId, now + LEASE_MS, now, runId)
    return row ? rowToRun(row) : null
  }

  async #execute(claimed: RunRecord): Promise<void> {
    const now = Date.now()
    const startedRow = this.#db
      .query<RunRow, [number, number | null, number, string]>(
        `UPDATE runs SET status = 'running', started_at = COALESCE(?2, ?1), updated_at = ?3 WHERE id = ?4
         RETURNING ${RUN_COLUMNS}`,
      )
      .get(now, claimed.startedAt ?? null, now, claimed.id)
    const run = startedRow ? rowToRun(startedRow) : claimed
    this.#onRunChanged?.(run)
    const executor = this.#executors[run.kind]
    let outcome: RunOutcome
    if (!executor) {
      outcome = {type: 'failed', error: {code: 'no-executor', message: `No executor for run kind: ${run.kind}`}}
    } else {
      try {
        outcome = await executor(run)
      } catch (error) {
        outcome = {
          type: 'failed',
          error: {
            code: 'executor-error',
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        }
      }
    }
    this.#finalize(run, outcome)
  }

  #finalize(run: RunRecord, outcome: RunOutcome): void {
    const now = Date.now()
    // Parking re-registers whatever it is listening for; every other outcome is done listening.
    if (outcome.type !== 'parked') this.#clearEventWaits(run.id)
    // Cancellation may have landed while the executor ran; canceled is sticky.
    const current = this.#getRunAnyAccount(run.id)
    if (!current || TERMINAL_RUN_STATUSES.includes(current.status)) {
      if (current) this.#onRunChanged?.(current)
      return
    }
    let row: RunRow | null = null
    if (outcome.type === 'parked') {
      row = this.#db
        .query<RunRow, [Uint8Array, number | null, number, string]>(
          `UPDATE runs SET status = 'waiting', wait_cbor = ?1, lease_owner = NULL, lease_expires_at = NULL,
             not_before = ?2, updated_at = ?3 WHERE id = ?4 RETURNING ${RUN_COLUMNS}`,
        )
        .get(cbor.encode(outcome.wait), parkWakeAt(outcome.wait), now, run.id)
    } else if (outcome.type === 'succeeded') {
      row = this.#db
        .query<RunRow, [Uint8Array, number, string]>(
          `UPDATE runs SET status = 'succeeded', output_cbor = ?1, error_cbor = NULL, wait_cbor = NULL,
             finished_at = ?2, updated_at = ?2 WHERE id = ?3 RETURNING ${RUN_COLUMNS}`,
        )
        .get(cbor.encode(outcome.output ?? null), now, run.id)
    } else if (outcome.type === 'canceled') {
      row = this.#db
        .query<RunRow, [Uint8Array | null, number, string]>(
          `UPDATE runs SET status = 'canceled', output_cbor = ?1, wait_cbor = NULL,
             finished_at = ?2, updated_at = ?2 WHERE id = ?3 RETURNING ${RUN_COLUMNS}`,
        )
        .get(outcome.output === undefined ? null : cbor.encode(outcome.output), now, run.id)
    } else {
      const retryable = outcome.error.retryable === true && current.attempt < current.maxAttempts
      if (retryable) {
        const backoff = Math.min(this.#retryBaseMs * 2 ** (current.attempt - 1), RETRY_CAP_MS)
        const jitter = Math.floor(Math.random() * Math.min(1_000, this.#retryBaseMs))
        row = this.#db
          .query<RunRow, [Uint8Array, number, number, string]>(
            `UPDATE runs SET status = 'queued', error_cbor = ?1, lease_owner = NULL, lease_expires_at = NULL,
               not_before = ?2, updated_at = ?3 WHERE id = ?4 RETURNING ${RUN_COLUMNS}`,
          )
          .get(cbor.encode(outcome.error), now + backoff + jitter, now, run.id)
      } else {
        row = this.#db
          .query<RunRow, [Uint8Array, number, string]>(
            `UPDATE runs SET status = 'failed', error_cbor = ?1, wait_cbor = NULL,
               finished_at = ?2, updated_at = ?2 WHERE id = ?3 RETURNING ${RUN_COLUMNS}`,
          )
          .get(cbor.encode(outcome.error), now, run.id)
      }
    }
    if (!row) return
    const updated = rowToRun(row)
    this.#onRunChanged?.(updated)
    if (TERMINAL_RUN_STATUSES.includes(updated.status)) {
      if (updated.parentRunId) this.#rollupChildUsage(updated)
      this.#onRunFinalized?.(updated)
    }
  }

  #rollupChildUsage(child: RunRecord): void {
    if (!child.parentRunId) return
    const parent = this.#getRunAnyAccount(child.parentRunId)
    if (!parent) return
    const usage: RunUsage = parent.usage ?? {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}
    const children = usage.children ?? {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, runs: 0}
    const childUsage = child.usage
    if (childUsage) {
      children.input += childUsage.input + (childUsage.children?.input ?? 0)
      children.output += childUsage.output + (childUsage.children?.output ?? 0)
      children.cacheRead += childUsage.cacheRead + (childUsage.children?.cacheRead ?? 0)
      children.cacheWrite += childUsage.cacheWrite + (childUsage.children?.cacheWrite ?? 0)
      children.total += childUsage.total + (childUsage.children?.total ?? 0)
    }
    children.runs += 1
    usage.children = children
    this.updateUsage(parent.id, usage)
  }
}
