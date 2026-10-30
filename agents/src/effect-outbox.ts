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
 * - `running` left by a process that is gone, or `interrupted` after the boot sweep: the call is
 *   answered as interrupted, naming the effect, so the model checks one thing instead of guessing.
 *
 * Reads (`read`, `plan`, `status`, and the read-only callables) never get a row: repeating them is
 * free. See {@link classifyEffect}.
 *
 * Rows are keyed by session and tool call id, which Pi Durable keeps stable across a rerun. The
 * input digest is kept so a receipt is never returned for a call whose arguments changed, which
 * cannot happen through the harness but is cheap to refuse. Settled rows are pruned after
 * {@link RETENTION_MS}.
 */

import type {Database} from 'bun:sqlite'
import * as cbor from '@/cbor'
import {stmt} from '@/statements'

/** How long a settled receipt is kept. A resumed turn needs it for minutes; a week is generous. */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** A lease this old on a `running` row belongs to a process that is gone (the server is one process). */
export const LEASE_MS = 60 * 60 * 1000

export type EffectStatus = 'running' | 'succeeded' | 'failed' | 'interrupted'

/** What a tool call does to the world, or `read` when it does nothing worth recording. */
export type EffectClass = {
  /** `read` for calls that may simply run again; anything else names the effect for people and the model. */
  kind: string
  /** Whether a call cut off mid-effect may run again instead of being answered as interrupted. */
  repeatable: boolean
}

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
  attempt: number
  leaseOwner: string | null
  leaseExpiresAt: number | null
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
  attempt: number
  lease_owner: string | null
  lease_expires_at: number | null
  response_cbor: Uint8Array | null
  error: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

const COLUMNS = `id, account_id, session_id, run_id, tool_call_id, tool, kind, input_digest, status, attempt,
  lease_owner, lease_expires_at, response_cbor, error, created_at, updated_at, completed_at`

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
    attempt: row.attempt,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
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
 * cut-off call simply runs again, as it always has. A `write` is named by its address, a `call` by
 * the tool it calls, and a promoted callable by its own name. The kinds are the words an
 * interrupted result shows the model, so they say what to check: `publish`, `memory-write`,
 * `execute`, `mcp:<name>`.
 */
export function classifyEffect(tool: string, args: unknown): EffectClass {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  const read = {kind: 'read', repeatable: true}
  switch (tool) {
    case 'read':
    case 'plan':
    case 'status':
      return read
    case 'write': {
      if (input.dryRun === true) return read
      const address = typeof input.address === 'string' ? input.address.trim() : ''
      if (address.startsWith('~/triggers/')) return {kind: 'trigger-write', repeatable: false}
      if (address.startsWith('~/tools/')) return {kind: 'tool-write', repeatable: false}
      if (address.startsWith('~/memory/') || address.startsWith('~/')) return {kind: 'memory-write', repeatable: false}
      if (address.startsWith('ipfs:')) return {kind: 'ipfs-upload', repeatable: false}
      if (address.startsWith('hm://') || address.startsWith('hm:')) return {kind: 'publish', repeatable: false}
      return {kind: 'write', repeatable: false}
    }
    case 'call': {
      const name = typeof input.tool === 'string' ? input.tool.trim() : ''
      if (!name) return read
      return classifyCallable(name)
    }
    case 'delegate':
      return {kind: 'delegate', repeatable: false}
    case 'continue_session':
      return {kind: 'continue-session', repeatable: false}
    case 'return_result':
      return {kind: 'return-result', repeatable: false}
    default:
      // A promoted callable is offered under its own name and runs through the call verb.
      return classifyCallable(tool)
  }
}

function classifyCallable(name: string): EffectClass {
  if (READ_ONLY_CALLABLES.has(name)) return {kind: 'read', repeatable: true}
  if (name === 'execute') return {kind: 'execute', repeatable: false}
  if (name === 'browser') return {kind: 'browser', repeatable: false}
  if (name === 'navigate') return {kind: 'navigate', repeatable: false}
  // An authored lambda or an MCP tool: it may do anything, so it is recorded under its own name.
  return {kind: `call:${name}`, repeatable: false}
}

/** What the wrapper around a tool does with a call, decided from the outbox before the tool runs. */
export type Disposition =
  /** No record of the effect: run it. The row now exists as `running`. */
  | {state: 'run'; row: EffectRow}
  /** The effect already ended: answer with its receipt. */
  | {state: 'settled'; row: EffectRow}
  /** The effect began under a process that is gone and nobody knows how it ended. */
  | {state: 'interrupted'; row: EffectRow}
  /** The same effect is running right now in this process (two executions of one call). */
  | {state: 'in-flight'; row: EffectRow}

export type BeginOptions = {
  accountId: string
  sessionId: string
  runId?: string
  toolCallId: string
  tool: string
  kind: string
  args: unknown
  /** The process running the effect; the boot sweep treats every other owner as gone. */
  owner: string
  now?: number
}

/**
 * Records that a tool call is about to perform its effect, or finds what an earlier process
 * recorded for the same call. The insert commits before this returns, so a process death after it
 * leaves a `running` row the boot sweep settles, and a process death before it leaves nothing,
 * which the rerun reads as "never began".
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
      // `running`: this process is executing it right now, or a dead process never got to settle it.
      const live = existing.leaseOwner === options.owner && (existing.leaseExpiresAt ?? 0) > now
      if (live) return {state: 'in-flight', row: existing}
      const interrupted = markInterrupted(db, id, now, 'The server process ended before this effect completed.')
      return {state: 'interrupted', row: interrupted ?? existing}
    }
    if (existing) stmt(db, `DELETE FROM effect_outbox WHERE id = ?`).run([id])
    stmt(
      db,
      `INSERT INTO effect_outbox (${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', 1, ?, ?, NULL, NULL, ?, ?, NULL)`,
    ).run([
      id,
      options.accountId,
      options.sessionId,
      options.runId ?? null,
      options.toolCallId,
      options.tool,
      options.kind,
      digest,
      options.owner,
      now + LEASE_MS,
      now,
      now,
    ])
    const row = get(db, id)
    if (!row) throw new Error('Effect outbox row vanished inside its own transaction')
    return {state: 'run', row}
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
         lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
    ).run([outcome.error, now, now, id])
    return
  }
  stmt(
    db,
    `UPDATE effect_outbox SET status = 'succeeded', response_cbor = ?, error = NULL, lease_owner = NULL,
       lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
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

/** Marks a `running` effect of a run that is over as interrupted; a settled row is left alone. */
export function interrupt(db: Database, id: string, reason: string, now: number = Date.now()): EffectRow | null {
  return markInterrupted(db, id, now, reason)
}

function markInterrupted(db: Database, id: string, now: number, error: string): EffectRow | null {
  stmt(
    db,
    `UPDATE effect_outbox SET status = 'interrupted', error = ?, lease_owner = NULL, lease_expires_at = NULL,
       updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'`,
  ).run([error, now, now, id])
  return get(db, id)
}

/** One effect by id, or null. */
export function get(db: Database, id: string): EffectRow | null {
  const row = stmt<EffectDbRow, [string]>(db, `SELECT ${COLUMNS} FROM effect_outbox WHERE id = ?`).get(id)
  return row ? rowToEffect(row) : null
}

/** Every effect recorded for a session, oldest first. */
export function listForSession(db: Database, sessionId: string): EffectRow[] {
  return stmt<EffectDbRow, [string]>(
    db,
    `SELECT ${COLUMNS} FROM effect_outbox WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
  )
    .all(sessionId)
    .map(rowToEffect)
}

/**
 * Settles what a dead process left behind. The server is one process, so at boot every `running`
 * row belongs to a process that is gone. A repeatable effect's row is deleted, so the rerun starts
 * clean; any other becomes `interrupted` with a reason, which is what the rerun answers with.
 */
export function sweepAtBoot(
  db: Database,
  options: {repeatable?: (kind: string) => boolean; now?: number} = {},
): {interrupted: number; cleared: number} {
  const now = options.now ?? Date.now()
  const repeatable = options.repeatable ?? (() => false)
  const running = stmt<{id: string; kind: string}, []>(
    db,
    `SELECT id, kind FROM effect_outbox WHERE status = 'running'`,
  ).all()
  let interrupted = 0
  let cleared = 0
  db.transaction(() => {
    for (const row of running) {
      if (repeatable(row.kind)) {
        stmt(db, `DELETE FROM effect_outbox WHERE id = ?`).run([row.id])
        cleared += 1
      } else {
        markInterrupted(db, row.id, now, 'The server process ended before this effect completed.')
        interrupted += 1
      }
    }
  })()
  if (interrupted > 0 || cleared > 0) {
    console.info('[agents/outbox] boot sweep settled effects a dead process left running', {interrupted, cleared})
  }
  return {interrupted, cleared}
}

/** Deletes settled receipts older than the retention window. Returns how many went. */
export function prune(db: Database, now: number = Date.now(), retentionMs: number = RETENTION_MS): number {
  const cutoff = now - retentionMs
  return stmt(db, `DELETE FROM effect_outbox WHERE status != 'running' AND COALESCE(completed_at, updated_at) < ?`).run(
    [cutoff],
  ).changes
}

/**
 * The text a call cut off mid-effect is answered with: it names the effect and the one thing to
 * check, instead of the harness's generic "may have partially run".
 */
export function interruptedResultText(row: Pick<EffectRow, 'kind' | 'tool'>): string {
  const what = effectDescription(row.kind, row.tool)
  return `Interrupted by a service restart while ${what}. It may have completed before the restart. Check the result before repeating it.`
}

function effectDescription(kind: string, tool: string): string {
  switch (kind) {
    case 'publish':
      return 'publishing to a Hypermedia address'
    case 'ipfs-upload':
      return 'uploading to IPFS'
    case 'memory-write':
      return 'writing a memory file'
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
    case 'continue-session':
      return 'continuing into a successor session'
    case 'return-result':
      return 'returning the typed result'
    default:
      return kind.startsWith('call:') ? `calling ${kind.slice('call:'.length)}` : `running ${tool}`
  }
}
