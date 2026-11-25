/**
 * Effect outbox: a durable record of every side effect a tool call is about to perform, and the
 * receipt of what it did.
 *
 * Pi Durable records the intent of a tool call (its final arguments and replay policy) before the
 * tool runs, and on recovery either reruns a replay-safe tool or answers an unsafe one as
 * "interrupted and may have partially run". That is the right answer when nothing else is known.
 * Seed knows more: the verb itself can say whether the effect began, and whether it finished. This
 * table is where it says so.
 *
 * One row per tool call that has an effect on the world (a publish, a memory write, a sandbox run,
 * an MCP call, a delegation). The row is inserted, and committed, before the effect begins; the
 * outcome is written to the same row when the effect ends. A turn resumed after a process death
 * reruns the call, and the wrapper around the tool asks this table first:
 *
 * - no row: the effect never began, so it runs now;
 * - `succeeded` or `failed`: the stored response is returned, and the effect does not run again;
 * - `running` left by a run that is over, or `interrupted` after the boot sweep: the call is
 *   answered as interrupted, naming the effect, so the model checks one thing instead of guessing.
 *
 * Reads (`read`, `plan`, `status`, the read-only callables) and the verbs that are idempotent on
 * their own (`continue_session`, `return_result`) never get a row: repeating them is free. They
 * classify as `read`; see {@link classifyEffect}.
 *
 * Rows are keyed by session and tool call id, which Pi Durable keeps stable across a rerun. The
 * input digest is kept so a receipt is never returned for a call whose arguments changed, which
 * cannot happen through the harness but is cheap to refuse. Settled rows are pruned after
 * {@link RETENTION_MS}.
 */

import type {Database} from 'bun:sqlite'
import * as cbor from '@/cbor'
import {stmt} from '@/statements'

/** How long a settled receipt is kept. A resumed turn needs it for minutes; two days is generous. */
export const RETENTION_MS = 2 * 24 * 60 * 60 * 1000

/** The reason an effect's row carries once a process death settled it. */
export const INTERRUPTED_BY_RESTART = 'The server process ended before this effect completed.'
/** The reason when the run that started the effect is over but the process is not. */
export const INTERRUPTED_BY_RUN_END = 'The run that started this effect ended before it completed.'

export type EffectStatus = 'running' | 'succeeded' | 'failed' | 'interrupted'

/**
 * What a tool call does to the world: `read` for a call that may simply run again and gets no row,
 * anything else the name of the effect, as an interrupted result shows it to the model.
 */
export type EffectKind = string

/** The kind of a call that gets no row. */
export const READ: EffectKind = 'read'

export type EffectRow = {
  id: string
  accountId: string
  sessionId: string
  runId: string | null
  toolCallId: string
  tool: string
  kind: string
  inputDigest: string
  status: EffectStatus
  /** The process that ran the effect, while it runs: tells a run that ended from a process that died. */
  leaseOwner: string | null
  response: unknown
  error: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

type EffectDbRow = {
  id: string
  account_id: string
  session_id: string
  run_id: string | null
  tool_call_id: string
  tool: string
  kind: string
  input_digest: string
  status: EffectStatus
  lease_owner: string | null
  response_cbor: Uint8Array | null
  error: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

const COLUMNS = `id, account_id, session_id, run_id, tool_call_id, tool, kind, input_digest, status,
  lease_owner, response_cbor, error, created_at, updated_at, completed_at`

function rowToEffect(row: EffectDbRow): EffectRow {
  return {
    id: row.id,
    accountId: row.account_id,
    sessionId: row.session_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    tool: row.tool,
    kind: row.kind,
    inputDigest: row.input_digest,
    status: row.status,
    leaseOwner: row.lease_owner,
    response: row.response_cbor ? cbor.decode(row.response_cbor) : undefined,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

/** The outbox row id of a tool call: one call, one effect. */
export function effectId(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`
}

/** A stable digest of a tool call's arguments, so a receipt only ever answers the call that made it. */
export function inputDigest(args: unknown): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(stableJson(args))
  return hasher.digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

/** Callables of the `call` verb that only read. Any other callable acts on something. */
const READ_ONLY_CALLABLES: ReadonlySet<string> = new Set(['search', 'query', 'attributes', 'web_search'])

/**
 * What a tool call does to the world, from its name and arguments alone, before it runs.
 *
 * The verbs that only read (`read`, `plan`, `status`) and the read-only callables are `read`: a
 * cut-off call simply runs again, as it always has. `continue_session` and `return_result` are
 * repeatable too, because they are idempotent by themselves: the first finds its own continuation
 * row, the second only sets the turn's state. A `write` is named by its address, a `call` by the
 * tool it calls, and a promoted callable by its own name. The kinds are the words an interrupted
 * result shows the model, so they say what to check: `publish`, `memory-write`, `execute`,
 * `call:<name>`.
 */
export function classifyEffect(tool: string, args: unknown): EffectKind {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  switch (tool) {
    case 'read':
    case 'plan':
    case 'status':
    case 'continue_session':
    case 'return_result':
      return READ
    case 'write': {
      if (input.dryRun === true) return READ
      const address = typeof input.address === 'string' ? input.address.trim() : ''
      if (address.startsWith('~/triggers/')) return 'trigger-write'
      if (address.startsWith('~/tools/')) return 'tool-write'
      if (address.startsWith('~/memory/')) return 'memory-write'
      if (address.startsWith('~/')) return 'space-write'
      if (address.startsWith('ipfs:')) return 'ipfs-upload'
      if (address.startsWith('hm://') || address.startsWith('hm:')) return 'publish'
      return 'write'
    }
    case 'call': {
      const name = typeof input.tool === 'string' ? input.tool.trim() : ''
      // A call with no tool name answers with the listing: nothing to record.
      return name ? classifyCallable(name) : READ
    }
    case 'delegate':
      return 'delegate'
    default:
      // A promoted callable is offered under its own name and runs through the call verb.
      return classifyCallable(tool)
  }
}

function classifyCallable(name: string): EffectKind {
  if (READ_ONLY_CALLABLES.has(name)) return READ
  if (name === 'execute' || name === 'browser' || name === 'navigate') return name
  // An authored lambda or an MCP tool: it may do anything, so it is recorded under its own name.
  return `call:${name}`
}

/** What the wrapper around a tool does with a call, decided from the outbox before the tool runs. */
export type Disposition =
  /** No record of the effect: run it. The row now exists as `running`. */
  | {state: 'run'; row: EffectRow}
  /** The effect already ended: answer with its receipt. */
  | {state: 'settled'; row: EffectRow}
  /** The effect began under a run that is over and nobody knows how it ended. */
  | {state: 'interrupted'; row: EffectRow}

export type BeginOptions = {
  accountId: string
  sessionId: string
  runId?: string
  toolCallId: string
  tool: string
  kind: string
  args: unknown
  /** The process running the effect; a rerun tells a run that ended from a process that died by it. */
  owner: string
  now?: number
}

/**
 * Records that a tool call is about to perform its effect, or finds what an earlier run recorded
 * for the same call. The insert commits before this returns, so a process death after it leaves a
 * `running` row the boot sweep settles, and a process death before it leaves nothing, which the
 * rerun reads as "never began".
 *
 * A `running` row found here always belongs to a run that is over: the harness reruns a call only
 * after its earlier execution was lost, and the caller keeps two executions of one call in this
 * process apart. So it is settled as interrupted, with a reason that says whether the process
 * survived.
 *
 * A row whose arguments differ from this call's is treated as foreign: it is replaced, because a
 * receipt must only ever answer the call that earned it. Through the harness the arguments of one
 * call id never change; the check costs one string compare.
 */
export function begin(db: Database, options: BeginOptions): Disposition {
  const now = options.now ?? Date.now()
  const id = effectId(options.sessionId, options.toolCallId)
  const digest = inputDigest(options.args)
  return db.transaction((): Disposition => {
    const existing = get(db, id)
    if (existing && existing.inputDigest === digest) {
      if (existing.status === 'succeeded' || existing.status === 'failed') return {state: 'settled', row: existing}
      if (existing.status === 'interrupted') return {state: 'interrupted', row: existing}
      const reason = existing.leaseOwner === options.owner ? INTERRUPTED_BY_RUN_END : INTERRUPTED_BY_RESTART
      return {state: 'interrupted', row: interrupt(db, id, reason, now) ?? existing}
    }
    if (existing) stmt(db, `DELETE FROM effect_outbox WHERE id = ?`).run([id])
    const row = stmt<
      EffectDbRow,
      [string, string, string, string | null, string, string, string, string, string, number]
    >(
      db,
      `INSERT INTO effect_outbox (${COLUMNS})
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'running', ?9, NULL, NULL, ?10, ?10, NULL) RETURNING ${COLUMNS}`,
    ).get(
      id,
      options.accountId,
      options.sessionId,
      options.runId ?? null,
      options.toolCallId,
      options.tool,
      options.kind,
      digest,
      options.owner,
      now,
    )
    if (!row) throw new Error('INSERT … RETURNING produced no row')
    return {state: 'run', row: rowToEffect(row)}
  })()
}

/** Writes the receipt of an effect: what the tool returned, or the error it ended with. */
export function complete(
  db: Database,
  id: string,
  outcome: {response: unknown} | {error: string},
  now: number = Date.now(),
): void {
  if ('error' in outcome) {
    stmt(
      db,
      `UPDATE effect_outbox SET status = 'failed', error = ?, response_cbor = NULL, lease_owner = NULL,
       updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
    ).run([outcome.error, now, now, id])
    return
  }
  stmt(
    db,
    `UPDATE effect_outbox SET status = 'succeeded', response_cbor = ?, error = NULL, lease_owner = NULL,
       updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
  ).run([cbor.encode(outcome.response), now, now, id])
}

/**
 * Settles an interrupted effect whose outcome was found elsewhere (a delegate's child run exists):
 * the row becomes a receipt, so later reruns are answered without looking again.
 */
export function recover(db: Database, id: string, response: unknown, now: number = Date.now()): EffectRow | null {
  const updated = stmt(
    db,
    `UPDATE effect_outbox SET status = 'succeeded', response_cbor = ?, error = NULL, updated_at = ?, completed_at = ?
       WHERE id = ? AND status = 'interrupted'`,
  ).run([cbor.encode(response), now, now, id]).changes
  return updated > 0 ? get(db, id) : null
}

/** Marks a `running` effect of a run that is over as interrupted, with the reason; a settled row is left alone. */
export function interrupt(db: Database, id: string, reason: string, now: number = Date.now()): EffectRow | null {
  stmt(
    db,
    `UPDATE effect_outbox SET status = 'interrupted', error = ?, lease_owner = NULL,
       updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
  ).run([reason, now, now, id])
  return get(db, id)
}

/** One effect by id, or null. */
export function get(db: Database, id: string): EffectRow | null {
  const row = stmt<EffectDbRow, [string]>(db, `SELECT ${COLUMNS} FROM effect_outbox WHERE id = ?`).get(id)
  return row ? rowToEffect(row) : null
}

/**
 * Settles what a dead process left behind. The server is one process, so at boot every `running`
 * row belongs to a process that is gone: it becomes `interrupted`, which is what a rerun answers
 * with. Returns how many rows that was.
 */
export function sweepAtBoot(db: Database, now: number = Date.now()): number {
  const interrupted = stmt(
    db,
    `UPDATE effect_outbox SET status = 'interrupted', error = ?, lease_owner = NULL,
       updated_at = ?, completed_at = ? WHERE status = 'running'`,
  ).run([INTERRUPTED_BY_RESTART, now, now]).changes
  if (interrupted > 0) {
    console.info('[agents/outbox] boot sweep settled effects a dead process left running', {interrupted})
  }
  return interrupted
}

/** Deletes settled receipts older than the retention window, by `effect_outbox_by_status`. Returns how many went. */
export function prune(db: Database, now: number = Date.now(), retentionMs: number = RETENTION_MS): number {
  const cutoff = now - retentionMs
  return stmt(
    db,
    `DELETE FROM effect_outbox WHERE status IN ('succeeded', 'failed', 'interrupted') AND completed_at < ?`,
  ).run([cutoff]).changes
}

/**
 * The text a call cut off mid-effect is answered with: it names the effect, says why nothing more
 * is known, and names the one thing to do, instead of the harness's generic "may have partially
 * run".
 */
export function interruptedResultText(row: Pick<EffectRow, 'kind' | 'tool' | 'error'>): string {
  const why = row.error || INTERRUPTED_BY_RUN_END
  return `Interrupted while ${effectDescription(
    row.kind,
    row.tool,
  )}. ${why} It may have completed. Check the result before repeating it.`
}

function effectDescription(kind: string, tool: string): string {
  switch (kind) {
    case 'publish':
      return 'publishing to a Hypermedia address'
    case 'ipfs-upload':
      return 'uploading to IPFS'
    case 'memory-write':
      return 'writing a memory file'
    case 'space-write':
      return 'writing to the agent space'
    case 'trigger-write':
      return 'changing a trigger'
    case 'tool-write':
      return 'saving an authored tool'
    case 'execute':
      return 'running code in the sandbox'
    case 'browser':
      return 'driving the browser'
    case 'navigate':
      return 'navigating'
    case 'delegate':
      return 'starting a delegated child'
    default:
      return kind.startsWith('call:') ? `calling ${kind.slice('call:'.length)}` : `running ${tool}`
  }
}
