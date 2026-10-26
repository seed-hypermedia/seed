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

type PrivacyScan = {
  lastSeq: number
  private: boolean
  sessions: Set<string>
  runs: Set<string>
  initialized: boolean
}

/**
 * Reader projection of browser-bearing transcripts. Once a transcript contains private data,
 * model-authored text, tool calls, plans and handoffs may quote it too. Hide those derivatives as
 * well as the original call. This never changes the durable log or the owner's model context.
 */
export class BrowserPrivacy {
  readonly #sessions = new Map<string, PrivacyScan>()
  readonly #runs = new Map<string, PrivacyScan>()

  constructor(private readonly db: Database) {}

  #scanState(cache: Map<string, PrivacyScan>, id: string): PrivacyScan {
    let state = cache.get(id)
    if (!state) {
      state = {lastSeq: 0, private: false, sessions: new Set(), runs: new Set(), initialized: false}
      cache.set(id, state)
    }
    return state
  }

  #observe(state: PrivacyScan, seq: number, value: unknown): void {
    // Eager appends may arrive before the first history scan. Never skip the unscanned gap.
    if (seq === state.lastSeq + 1) state.lastSeq = seq
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

  /** Marks appended events before fan-out, without decoding or rescanning their persisted rows. */
  recordSessionEvent(info: api.SessionEvent): void {
    this.#observe(this.#scanState(this.#sessions, info.sessionId), info.seq, info.event)
  }

  /** Marks workflow journal appends even when the service has no subscribers. */
  recordRunEntry(info: api.RunJournalEntryInfo): void {
    this.#observe(this.#scanState(this.#runs, info.runId), info.seq, info.entry)
  }

  #inheritsPrivacy(state: PrivacyScan, seen: Set<string>): boolean {
    // Keep dependencies, not negative snapshots: a source may become private after this scan.
    for (const id of state.sessions) if (this.sessionIsPrivate(id, seen)) return true
    for (const id of state.runs) if (this.runIsPrivate(id, seen)) return true
    return false
  }

  /** Includes inherited context in child sessions and continuation projections. */
  sessionIsPrivate(sessionId: string, seen = new Set<string>()): boolean {
    const state = this.#scanState(this.#sessions, sessionId)
    if (state.private) return true
    const key = `session:${sessionId}`
    if (seen.has(key)) return false
    seen.add(key)
    const events = stmt<{seq: number; event_cbor: Uint8Array}, [string, number]>(
      this.db,
      'SELECT seq, event_cbor FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq',
    ).all(sessionId, state.lastSeq)
    for (const row of events) {
      this.#observe(state, row.seq, cbor.decode(row.event_cbor))
      state.lastSeq = row.seq
      if (state.private) return true
    }
    // Continuation links can be inserted after the successor's creation has emitted a frame.
    const sources = stmt<{id: string}, [string, string]>(
      this.db,
      `SELECT parent_session_id AS id FROM sessions WHERE id = ? AND parent_session_id IS NOT NULL
       UNION SELECT predecessor_session_id AS id FROM session_continuations WHERE successor_session_id = ?`,
    ).all(sessionId, sessionId)
    for (const source of sources) state.sessions.add(source.id)
    state.private = this.#inheritsPrivacy(state, seen)
    return state.private
  }

  /** A workflow can carry private context in its parent, source, input, or incremental journal. */
  runIsPrivate(runId: string, seen = new Set<string>()): boolean {
    const state = this.#scanState(this.#runs, runId)
    if (state.private) return true
    const key = `run:${runId}`
    if (seen.has(key)) return false
    seen.add(key)
    if (!state.initialized) {
      const run = stmt<
        {
          session_id: string | null
          parent_run_id: string | null
          input_cbor: Uint8Array | null
          source_text: string | null
        },
        [string]
      >(this.db, 'SELECT session_id, parent_run_id, input_cbor, source_text FROM runs WHERE id = ?').get(runId)
      if (!run) return false
      // Source/input and lineage are fixed at creation; later writes append to the journal.
      state.initialized = true
      if (run.session_id) state.sessions.add(run.session_id)
      if (run.parent_run_id) state.runs.add(run.parent_run_id)
      state.private =
        containsPrivateData(run.source_text) ||
        Boolean(run.input_cbor && containsPrivateData(cbor.decode(run.input_cbor)))
      if (state.private) return true
    }
    const entries = stmt<{seq: number; entry_cbor: Uint8Array}, [string, number]>(
      this.db,
      'SELECT seq, entry_cbor FROM run_journal WHERE run_id = ? AND seq > ? ORDER BY seq',
    ).all(runId, state.lastSeq)
    for (const row of entries) {
      this.#observe(state, row.seq, cbor.decode(row.entry_cbor))
      state.lastSeq = row.seq
      if (state.private) return true
    }
    state.private = this.#inheritsPrivacy(state, seen)
    return state.private
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
