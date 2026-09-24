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
  if (typeof value === 'string') return /(?:~[\\/]memory[\\/]|^|["'\s])(?:[\\/]|\.[\\/])*private(?:[\\/]|$)/.test(value)
  if (!value || typeof value !== 'object' || value instanceof Uint8Array) return false
  const record = value as Record<string, unknown>
  if ([record.name, record.tool, record.toolName].includes('browser')) return true
  return Object.values(record).some(containsPrivateData)
}

/**
 * Reader projection of browser-bearing transcripts. Once a transcript contains private data,
 * model-authored text, tool calls, plans and handoffs may quote it too. Hide those derivatives as
 * well as the original call. This never changes the durable log or the owner's model context.
 */
export class BrowserPrivacy {
  readonly #privateSessions = new Set<string>()

  constructor(private readonly db: Database) {}

  /** Includes inherited context in child sessions and continuation projections. */
  sessionIsPrivate(sessionId: string, seen = new Set<string>()): boolean {
    if (this.#privateSessions.has(sessionId)) return true
    if (seen.has(sessionId)) return false
    seen.add(sessionId)
    const events = stmt<{event_cbor: Uint8Array}, [string]>(
      this.db,
      'SELECT event_cbor FROM session_events WHERE session_id = ?',
    ).all(sessionId)
    const referencesPrivateContext = (value: unknown): boolean => {
      if (typeof value === 'string') {
        for (const match of value.matchAll(/(?:thread|run):([a-zA-Z0-9-]+)/g)) {
          if (
            match[0].startsWith('thread:') ? this.sessionIsPrivate(match[1]!, seen) : this.runIsPrivate(match[1]!, seen)
          )
            return true
        }
        return false
      }
      if (!value || typeof value !== 'object' || value instanceof Uint8Array) return false
      const record = value as Record<string, unknown>
      if (typeof record.sessionId === 'string' && this.sessionIsPrivate(record.sessionId, seen)) return true
      return Object.values(record).some(referencesPrivateContext)
    }
    if (
      events.some((row) => {
        const event = cbor.decode<Record<string, unknown>>(row.event_cbor)
        return containsPrivateData(event) || (event.type === 'tool_call' && referencesPrivateContext(event.input))
      })
    ) {
      this.#privateSessions.add(sessionId)
      return true
    }
    const sources = stmt<{id: string}, [string, string]>(
      this.db,
      `SELECT parent_session_id AS id FROM sessions WHERE id = ? AND parent_session_id IS NOT NULL
       UNION SELECT predecessor_session_id AS id FROM session_continuations WHERE successor_session_id = ?`,
    ).all(sessionId, sessionId)
    return sources.some((source) => this.sessionIsPrivate(source.id, seen))
  }

  /** A workflow can carry private context in its parent, source, input, or journal. */
  runIsPrivate(runId: string, seen = new Set<string>()): boolean {
    if (seen.has(runId)) return false
    seen.add(runId)
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
    if (run.session_id && this.sessionIsPrivate(run.session_id, seen)) return true
    if (run.parent_run_id && this.runIsPrivate(run.parent_run_id, seen)) return true
    if (containsPrivateData(run.source_text) || (run.input_cbor && containsPrivateData(cbor.decode(run.input_cbor))))
      return true
    return stmt<{entry_cbor: Uint8Array}, [string]>(this.db, 'SELECT entry_cbor FROM run_journal WHERE run_id = ?')
      .all(runId)
      .some((row) => containsPrivateData(cbor.decode(row.entry_cbor)))
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
    const sessionPrivate = (id: string) => {
      if (!sessions.has(id)) sessions.set(id, this.sessionIsPrivate(id))
      return sessions.get(id)!
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
      const owner = sessionId
        ? stmt<{account_id: string}, [string]>(this.db, 'SELECT account_id FROM sessions WHERE id = ?').get(sessionId)
            ?.account_id
        : runId
          ? stmt<{account_id: string}, [string]>(this.db, 'SELECT account_id FROM runs WHERE id = ?').get(runId)
              ?.account_id
          : undefined
      if (owner && owner !== viewer) {
        if ('event' in row && 'seq' in row && sessionId)
          return this.event(row as api.SessionEvent, sessionPrivate(sessionId))
        const sensitive =
          containsPrivateData(row) || (sessionId && sessionPrivate(sessionId)) || (runId && this.runIsPrivate(runId))
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
