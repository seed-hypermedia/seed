import type {Database} from 'bun:sqlite'
import type * as api from '@seed-hypermedia/agents-protocol'
import * as cbor from '@/cbor'
import {stmt} from '@/statements'

/** Safe replacement for browser data; summaries never come from the page or the model. */
export function privateStub(action = 'browser'): Record<string, unknown> {
  return {redacted: true, action, summary: 'Private content is only available to the agent owner'}
}

/** Recognizes browser calls and private-memory references, including call envelopes and journals. */
export function containsPrivateData(value: unknown): boolean {
  // Plain prose about privacy is not a memory reference. Explicit memory addresses are, even
  // when embedded in markdown or workflow source. Match the aliases accepted at the memory boundary.
  if (typeof value === 'string') return /~[\\/]memory[\\/](?:[\\/]|\.[\\/])*private(?:[\\/]|$)/.test(value)
  if (!value || typeof value !== 'object' || value instanceof Uint8Array) return false
  const record = value as Record<string, unknown>
  const tools = [record.name, record.tool, record.toolName]
  if (tools.includes('browser')) return true
  if (
    tools.some((tool) => typeof tool === 'string' && /^(?:memory(?:_.*)?|read|write|publish|ipfs_write)$/.test(tool))
  ) {
    const privatePath = (input: unknown): boolean => {
      if (!input || typeof input !== 'object' || input instanceof Uint8Array) return false
      return Object.entries(input).some(([key, field]) => {
        if (['path', 'address', 'fromPath', 'memoryPath', 'toPath'].includes(key) && typeof field === 'string')
          return /^(?:~[\\/]memory[\\/])?(?:[\\/]|\.[\\/])*private(?:[\\/]|$)/.test(field)
        return (key === 'options' || key === 'input') && privatePath(field)
      })
    }
    if (privatePath(record.input) || privatePath(record.args)) return true
  }
  return Object.values(record).some(containsPrivateData)
}

type Kind = 'session' | 'run'

/** A transcript's persisted scan: one `transcript_privacy` row. */
type PrivacyScan = {
  scannedSeq: number
  private: boolean
  sessions: Set<string>
  runs: Set<string>
}

type PrivacyRow = {scanned_seq: number; private: number; sessions_json: string | null; runs_json: string | null}

/** Resolved reader privacy: public, private, or not scanned yet (private to non-owners until it is). */
const PUBLIC = 0
const PRIVATE = 1
const PENDING = 2
type Verdict = typeof PUBLIC | typeof PRIVATE | typeof PENDING

/** Backfill work per timer tick before yielding the loop, and the pauses between ticks. */
const BACKFILL_SLICE_MS = 20
const BACKFILL_PAUSE_MS = 50
const BACKFILL_LAGGING_SLICE_MS = 5
const BACKFILL_LAGGING_PAUSE_MS = 1_000
/** Unscanned transcripts remembered for backfill; the oldest requests drop off and come back on their next read. */
const BACKFILL_QUEUE_LIMIT = 10_000

function emptyScan(): PrivacyScan {
  return {scannedSeq: 0, private: false, sessions: new Set(), runs: new Set()}
}

export type BrowserPrivacyOptions = {
  /**
   * Scan transcripts whose `transcript_privacy` row is missing or behind on a throttled timer. The
   * service turns it on; tests call {@link BrowserPrivacy.drainBackfill} instead.
   */
  backfill?: boolean
  /** Whether the event loop is too busy for background work (see perf.ts `loopLagHealth`). */
  loopLagging?: () => boolean
}

/**
 * Reader projection of browser-bearing transcripts. Once a transcript contains private data,
 * model-authored text, tool calls, plans and handoffs may quote it too. Hide those derivatives as
 * well as the original call. This never changes the durable log or the owner's model context.
 *
 * Privacy is persisted per transcript in `transcript_privacy` and maintained as events and journal
 * entries are appended, so deciding it on the read path costs a few primary-key lookups and never
 * reads a `session_events` or `run_journal` body. A transcript whose row is missing or behind its
 * last sequence (written before the table existed, or by a process that died between the append
 * and the flag write) is PENDING: private to non-owners (fail closed) and queued for a throttled
 * background scan that persists its row.
 */
export class BrowserPrivacy {
  /** Definite private results (privacy is monotone); pending verdicts are never cached. */
  readonly #private = new Set<string>()
  /** Backfill queue by `kind:id`, served most-recently-requested first (re-inserting moves an id to the end). */
  readonly #queue = new Map<string, {kind: Kind; id: string}>()
  #timer: ReturnType<typeof setTimeout> | undefined
  #stopped = false
  #backfilled = 0
  #lastLog = 0

  constructor(
    private readonly db: Database,
    private readonly options: BrowserPrivacyOptions = {},
  ) {}

  #load(kind: Kind, id: string): PrivacyScan | undefined {
    const row = stmt<PrivacyRow, [string, string]>(
      this.db,
      'SELECT scanned_seq, private, sessions_json, runs_json FROM transcript_privacy WHERE kind = ? AND id = ?',
    ).get(kind, id)
    if (!row) return undefined
    return {
      scannedSeq: row.scanned_seq,
      private: row.private === 1,
      sessions: new Set(row.sessions_json ? (JSON.parse(row.sessions_json) as string[]) : []),
      runs: new Set(row.runs_json ? (JSON.parse(row.runs_json) as string[]) : []),
    }
  }

  #save(kind: Kind, id: string, state: PrivacyScan): void {
    stmt(
      this.db,
      `INSERT INTO transcript_privacy (kind, id, scanned_seq, private, sessions_json, runs_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, id) DO UPDATE SET scanned_seq = excluded.scanned_seq, private = excluded.private,
         sessions_json = excluded.sessions_json, runs_json = excluded.runs_json`,
    ).run([
      kind,
      id,
      state.scannedSeq,
      state.private ? 1 : 0,
      state.sessions.size ? JSON.stringify([...state.sessions]) : null,
      state.runs.size ? JSON.stringify([...state.runs]) : null,
    ])
    if (state.private) this.#private.add(`${kind}:${id}`)
  }

  /** Highest appended sequence, from the (id, seq) key alone: no event or entry body is read. */
  #lastSeq(kind: Kind, id: string): number {
    const row =
      kind === 'session'
        ? stmt<{seq: number | null}, [string]>(
            this.db,
            'SELECT MAX(seq) AS seq FROM session_events WHERE session_id = ?',
          ).get(id)
        : stmt<{seq: number | null}, [string]>(this.db, 'SELECT MAX(seq) AS seq FROM run_journal WHERE run_id = ?').get(
            id,
          )
    return row?.seq ?? 0
  }

  /** A run's creation-time content and lineage (fixed when it is made); undefined when there is no such run. */
  #initRun(runId: string): PrivacyScan | undefined {
    const run = stmt<
      {
        session_id: string | null
        parent_run_id: string | null
        input_cbor: Uint8Array | null
        source_text: string | null
      },
      [string]
    >(this.db, 'SELECT session_id, parent_run_id, input_cbor, source_text FROM runs WHERE id = ?').get(runId)
    if (!run) return undefined
    const state = emptyScan()
    if (run.session_id) state.sessions.add(run.session_id)
    if (run.parent_run_id) state.runs.add(run.parent_run_id)
    state.private =
      containsPrivateData(run.source_text) ||
      Boolean(run.input_cbor && containsPrivateData(cbor.decode(run.input_cbor)))
    return state
  }

  #observe(state: PrivacyScan, value: unknown): void {
    if (state.private) return
    state.private = containsPrivateData(value)
    const record = value as Record<string, unknown>
    if (state.private || (record.type !== 'tool_call' && record.kind !== 'call')) return
    const references = (input: unknown): void => {
      if (typeof input === 'string') {
        for (const match of input.matchAll(/(?:thread|run):([a-zA-Z0-9-]+)/g))
          (match[0].startsWith('thread:') ? state.sessions : state.runs).add(match[1]!)
      } else if (input && typeof input === 'object' && !(input instanceof Uint8Array)) {
        const row = input as Record<string, unknown>
        if (typeof row.sessionId === 'string') state.sessions.add(row.sessionId)
        for (const field of Object.values(row)) references(field)
      }
    }
    references(record.input)
  }

  /**
   * The write path: folds one appended event or journal entry into the persisted row. Only a
   * contiguous append advances `scanned_seq`; after a gap (history from before the row existed)
   * a private append still marks the transcript private, and anything else queues the backfill.
   */
  #append(kind: Kind, id: string, seq: number, value: unknown): void {
    if (this.#private.has(`${kind}:${id}`)) return
    let state = this.#load(kind, id)
    if (state?.private) return
    if (!state && seq === 1) state = (kind === 'run' ? this.#initRun(id) : undefined) ?? emptyScan()
    if (state && seq <= state.scannedSeq) return
    if (state && seq === state.scannedSeq + 1) {
      this.#observe(state, value)
      state.scannedSeq = seq
      this.#save(kind, id, state)
      return
    }
    if (containsPrivateData(value)) {
      const marked = state ?? emptyScan()
      marked.private = true
      this.#save(kind, id, marked)
      return
    }
    this.#enqueue(kind, id)
  }

  /** Marks appended events before fan-out, without decoding or rescanning their persisted rows. */
  recordSessionEvent(info: api.SessionEvent): void {
    this.#append('session', info.sessionId, info.seq, info.event)
  }

  /** Marks workflow journal appends even when the service has no subscribers. */
  recordRunEntry(info: api.RunJournalEntryInfo): void {
    this.#append('run', info.runId, info.seq, info.entry)
  }

  /** Forgets a deleted session's row; its events are gone with it. */
  forgetSession(sessionId: string): void {
    stmt(this.db, `DELETE FROM transcript_privacy WHERE kind = 'session' AND id = ?`).run([sessionId])
    this.#private.delete(`session:${sessionId}`)
    this.#queue.delete(`session:${sessionId}`)
  }

  /** Sessions a session's privacy comes from: its parent and the session it continues. Indexed lookups. */
  #sessionSources(sessionId: string): string[] {
    return stmt<{id: string}, [string, string]>(
      this.db,
      `SELECT parent_session_id AS id FROM sessions WHERE id = ? AND parent_session_id IS NOT NULL
       UNION SELECT predecessor_session_id AS id FROM session_continuations WHERE successor_session_id = ?`,
    )
      .all(sessionId, sessionId)
      .map((row) => row.id)
  }

  #verdict(kind: Kind, id: string, seen: Set<string>): Verdict {
    const key = `${kind}:${id}`
    if (this.#private.has(key)) return PRIVATE
    if (seen.has(key)) return PUBLIC
    seen.add(key)
    let state = this.#load(kind, id)
    if (state?.private) {
      this.#private.add(key)
      return PRIVATE
    }
    const last = this.#lastSeq(kind, id)
    if (!state && kind === 'run' && last === 0) {
      // A run with no journal yet: deciding it is one primary-key read of its creation row.
      state = this.#initRun(id)
      if (state) this.#save(kind, id, state)
      if (state?.private) return PRIVATE
    }
    if ((state?.scannedSeq ?? 0) < last) {
      this.#enqueue(kind, id)
      return PENDING
    }
    // Keep dependencies, not negative snapshots: a source may become private after this scan.
    const sources: [Kind, string][] = [...(state?.sessions ?? [])].map((source) => ['session', source])
    if (kind === 'session') for (const source of this.#sessionSources(id)) sources.push(['session', source])
    for (const source of state?.runs ?? []) sources.push(['run', source])
    let verdict: Verdict = PUBLIC
    for (const [sourceKind, source] of sources) {
      const inherited = this.#verdict(sourceKind, source, seen)
      if (inherited === PRIVATE) {
        this.#private.add(key)
        return PRIVATE
      }
      if (inherited === PENDING) verdict = PENDING
    }
    return verdict
  }

  /**
   * Includes inherited context in child sessions and continuation projections. True while the
   * session, or a source it inherits from, is not scanned yet: fail closed for non-owners.
   */
  sessionIsPrivate(sessionId: string, seen = new Set<string>()): boolean {
    return this.#verdict('session', sessionId, seen) !== PUBLIC
  }

  /** A workflow can carry private context in its parent, source, input, or incremental journal. */
  runIsPrivate(runId: string, seen = new Set<string>()): boolean {
    return this.#verdict('run', runId, seen) !== PUBLIC
  }

  /**
   * The exact answer for the agent runtime, which is about to read the session's whole log for a
   * turn anyway: scans whatever of the session and its sources is not scanned yet, synchronously,
   * then decides. A pending verdict here would put redaction stubs into a run's own model context.
   * Never use it on the response or WebSocket path; that is what {@link sessionIsPrivate} is for.
   */
  scanSessionIsPrivate(sessionId: string): boolean {
    const visited = new Set<string>()
    const stack: [Kind, string][] = [['session', sessionId]]
    while (stack.length) {
      const [kind, id] = stack.pop()!
      const key = `${kind}:${id}`
      if (visited.has(key) || this.#private.has(key)) continue
      visited.add(key)
      this.#scan(kind, id, Number.POSITIVE_INFINITY)
      this.#queue.delete(key)
      const state = this.#load(kind, id)
      if (!state || state.private) continue
      for (const source of state.sessions) stack.push(['session', source])
      for (const source of state.runs) stack.push(['run', source])
      if (kind === 'session') for (const source of this.#sessionSources(id)) stack.push(['session', source])
    }
    return this.sessionIsPrivate(sessionId)
  }

  /** Whether a transcript's persisted row is current, so reading it decides from data alone. */
  isScanned(kind: Kind, id: string): boolean {
    const state = this.#load(kind, id)
    return Boolean(state?.private) || (state?.scannedSeq ?? 0) >= this.#lastSeq(kind, id)
  }

  /** Transcripts waiting for the backfill. */
  get backfillQueued(): number {
    return this.#queue.size
  }

  #enqueue(kind: Kind, id: string): void {
    const key = `${kind}:${id}`
    this.#queue.delete(key)
    this.#queue.set(key, {kind, id})
    if (this.#queue.size > BACKFILL_QUEUE_LIMIT) this.#queue.delete(this.#queue.keys().next().value!)
    if (this.options.backfill) this.#schedule(0)
  }

  #schedule(delay: number): void {
    if (this.#stopped || this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#tick()
    }, delay)
    this.#timer.unref?.()
  }

  #tick(): void {
    if (this.#stopped || this.#queue.size === 0) return
    // A busy loop still gets progress, but only a thin slice once a second, so the backfill never
    // becomes the disk-bound stall it replaces.
    const lagging = this.options.loopLagging?.() ?? false
    try {
      this.drainBackfill(performance.now() + (lagging ? BACKFILL_LAGGING_SLICE_MS : BACKFILL_SLICE_MS))
    } catch (error) {
      // A closed database (shutdown) or a corrupt row must not take the server down from a timer.
      console.warn('[agents/privacy] transcript privacy backfill failed; queue dropped', {
        error: error instanceof Error ? error.message : String(error),
      })
      this.#queue.clear()
      return
    }
    if (Date.now() - this.#lastLog > 60_000) {
      this.#lastLog = Date.now()
      console.log('[agents/privacy] transcript privacy backfill', {scanned: this.#backfilled, queued: this.#queue.size})
    }
    if (this.#queue.size) this.#schedule(lagging ? BACKFILL_LAGGING_PAUSE_MS : BACKFILL_PAUSE_MS)
  }

  /**
   * Scans queued transcripts most-recently-requested first, persisting progress, until the queue
   * is empty or `deadline` (a performance.now() time) passes. Bodies are read one at a time, so a
   * slice overruns its deadline by at most one event or journal entry.
   */
  drainBackfill(deadline = Number.POSITIVE_INFINITY): void {
    while (this.#queue.size) {
      let key = ''
      for (key of this.#queue.keys());
      const {kind, id} = this.#queue.get(key)!
      if (this.#scan(kind, id, deadline)) {
        this.#queue.delete(key)
        this.#backfilled += 1
      }
      if (performance.now() >= deadline) return
    }
  }

  /** Advances one transcript's persisted scan; true once it is current or private. */
  #scan(kind: Kind, id: string, deadline: number): boolean {
    const state = this.#load(kind, id) ?? (kind === 'run' ? this.#initRun(id) : undefined) ?? emptyScan()
    let done = state.private
    while (!done) {
      const next =
        kind === 'session'
          ? stmt<{seq: number; body: Uint8Array}, [string, number]>(
              this.db,
              'SELECT seq, event_cbor AS body FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT 1',
            ).get(id, state.scannedSeq)
          : stmt<{seq: number; body: Uint8Array}, [string, number]>(
              this.db,
              'SELECT seq, entry_cbor AS body FROM run_journal WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT 1',
            ).get(id, state.scannedSeq)
      if (!next) {
        done = true
        break
      }
      this.#observe(state, cbor.decode(next.body))
      state.scannedSeq = next.seq
      done = state.private
      if (performance.now() >= deadline) break
    }
    this.#save(kind, id, state)
    if (done && !state.private) {
      // Readers resolve these next: queue them now rather than one request at a time.
      const sources: [Kind, string][] = [...state.sessions].map((source) => ['session', source])
      if (kind === 'session') for (const source of this.#sessionSources(id)) sources.push(['session', source])
      for (const source of state.runs) sources.push(['run', source])
      for (const [sourceKind, source] of sources) {
        const key = `${sourceKind}:${source}`
        if (this.#queue.has(key) || this.isScanned(sourceKind, source)) continue
        this.#queue.set(key, {kind: sourceKind, id: source})
      }
    }
    return done
  }

  /** Stops the backfill timer (shutdown, tests). */
  stop(): void {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  /** Redacts before wire truncation, including results whose call is outside the requested page. */
  event(info: api.SessionEvent, sensitive = this.sessionIsPrivate(info.sessionId)): api.SessionEvent {
    if (!sensitive && !containsPrivateData(info.event)) return info
    const event = info.event as Record<string, unknown>
    const input = event.input as Record<string, unknown> | undefined
    const action = (input?.input as Record<string, unknown> | undefined)?.action ?? input?.action
    const stub = privateStub(
      ['snapshot', 'screenshot', 'click', 'type', 'press', 'scroll', 'navigate', 'archive'].includes(String(action))
        ? String(action)
        : 'browser',
    )
    const meta = event.meta as {accountId?: string; signerId?: string} | undefined
    if (
      event.type === 'message' &&
      event.role === 'user' &&
      event.actor !== 'system' &&
      meta?.accountId &&
      meta.signerId
    ) {
      return {...info, event: {...event, contextLines: undefined}}
    }
    const safe: Record<string, unknown> = {type: event.type, ...stub}
    for (const key of ['id', 'toolCallId', 'name', 'role', 'actor'])
      if (event[key] !== undefined) safe[key] = event[key]
    if (event.type === 'tool_call') safe.input = stub
    else if (event.type === 'tool_result') safe.output = stub
    else if (event.type === 'message') safe.content = JSON.stringify(stub)
    else if (event.type === 'error') safe.message = String(stub.summary)
    return {...info, event: safe, truncated: false}
  }

  /** Projects API responses and WebSocket frames for a particular authenticated reader. */
  forViewer<T>(value: T, viewer: string): T {
    const sessions = new Map<string, boolean>()
    const runs = new Map<string, boolean>()
    const owners = new Map<string, string | undefined>()
    const sessionPrivate = (id: string) => {
      if (!sessions.has(id)) sessions.set(id, this.sessionIsPrivate(id))
      return sessions.get(id)!
    }
    const runPrivate = (id: string) => {
      if (!runs.has(id)) runs.set(id, this.runIsPrivate(id))
      return runs.get(id)!
    }
    const visit = (item: unknown): unknown => {
      if (!item || typeof item !== 'object' || item instanceof Uint8Array) return item
      if (Array.isArray(item)) return item.map(visit)
      const row = item as Record<string, unknown>
      const keySession = typeof row.key === 'string' ? /^sessions\/(.+)$/.exec(row.key)?.[1] : undefined
      const responseSession = row.session as {id?: string} | undefined
      const keyRun = typeof row.key === 'string' ? /^runs\/(.+)$/.exec(row.key)?.[1] : undefined
      const sessionId =
        keySession ??
        responseSession?.id ??
        (typeof row.predecessorSessionId === 'string' ? row.predecessorSessionId : undefined) ??
        (typeof row.sessionId === 'string'
          ? row.sessionId
          : typeof row.id === 'string' && 'agentId' in row && !('rootRunId' in row)
            ? row.id
            : undefined)
      const runId =
        typeof row.runId === 'string' ? row.runId : typeof row.id === 'string' && 'rootRunId' in row ? row.id : keyRun
      const ownerKey = sessionId ? `session:${sessionId}` : runId ? `run:${runId}` : undefined
      if (ownerKey && !owners.has(ownerKey)) {
        const owner = sessionId
          ? stmt<{account_id: string}, [string]>(this.db, 'SELECT account_id FROM sessions WHERE id = ?').get(sessionId)
              ?.account_id
          : stmt<{account_id: string}, [string]>(this.db, 'SELECT account_id FROM runs WHERE id = ?').get(runId!)
              ?.account_id
        owners.set(ownerKey, owner)
      }
      const owner = ownerKey ? owners.get(ownerKey) : undefined
      // A session/run response belongs to one account. Owners need no projection or history scan.
      if (owner === viewer) return item
      if (owner && owner !== viewer) {
        if ('event' in row && 'seq' in row && sessionId)
          return this.event(row as api.SessionEvent, sessionPrivate(sessionId))
        const sensitive =
          containsPrivateData(row) || (sessionId && sessionPrivate(sessionId)) || (runId && runPrivate(runId))
        if (sensitive) {
          const result = {...row}
          for (const key of ['title', 'description', 'sourceText', 'textDelta', 'stepLabel', 'systemPromptMarkdown']) {
            if (key in result) result[key] = String(privateStub().summary)
          }
          for (const key of [
            'input',
            'output',
            'entry',
            'error',
            'activity',
            'patch',
            'plan',
            'wait',
            'unmetObligations',
            'handoff',
            'triggerContext',
            'trigger',
            'sources',
            'included',
            'omitted',
          ]) {
            if (key in result)
              result[key] =
                key === 'entry' || key === 'input' || key === 'output'
                  ? privateStub()
                  : key === 'patch'
                    ? {textDelta: '', done: true}
                    : undefined
          }
          return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, visit(value)]))
        }
      }
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, visit(value)]))
    }
    return visit(value) as T
  }
}
