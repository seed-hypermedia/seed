import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apisvc from '@/api-service'
import type * as api from '@/api'
import * as blobs from '@shm/shared/blobs'
import {decode as cborDecode} from '@/cbor'
import * as sqlite from '@/sqlite'

/**
 * Session continuation end to end: the agent calls continue_session, the predecessor keeps its
 * complete transcript and grows a continuedTo link, a successor is created with the title and
 * description the agent chose, its opening is the projection plus the user's exact message, and
 * its own run answers. Driven through the real run queue with a canned provider, because the
 * whole point is that the turn ENDS in one session and the answer lands in the other.
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

type Harness = {
  db: Database
  accountId: string
  agentId: string
  account: ReturnType<typeof blobs.generateNobleKeyPair>
  service: apisvc.Service
  send: (action: unknown) => Promise<api.AgentResponse>
}

async function createHarness(): Promise<Harness> {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-continuation-test-'))
  const account = blobs.generateNobleKeyPair()
  const service = new apisvc.Service(db, dataDir, {})
  const send = async (action: unknown) =>
    service.message(await apisvc.createSignedEnvelope(account, {action: action as never}))
  await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
  const created = await send({
    _: 'CreateAgent',
    definition: {name: 'Planner', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt-test'},
  })
  if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  cleanups.push(() => {
    service.stopRunQueue()
    db.close()
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  return {db, accountId: blobs.principalToString(account.principal), agentId: created.agentId, account, service, send}
}

type Chunk = Record<string, unknown>

function sse(chunks: Chunk[]): Response {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: {'content-type': 'text/event-stream'},
  })
}

function textReply(id: string, text: string, promptTokens: number): Chunk[] {
  return [
    {id, choices: [{index: 0, delta: {role: 'assistant', content: text}}]},
    {
      id,
      choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
      usage: {prompt_tokens: promptTokens, completion_tokens: 5, total_tokens: promptTokens + 5},
    },
  ]
}

function toolCallReply(id: string, callId: string, name: string, args: unknown, promptTokens: number): Chunk[] {
  return [
    {
      id,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [{index: 0, id: callId, type: 'function', function: {name, arguments: ''}}],
          },
        },
      ],
    },
    {
      id,
      choices: [{index: 0, delta: {tool_calls: [{index: 0, function: {arguments: JSON.stringify(args)}}]}}],
    },
    {
      id,
      choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}],
      usage: {prompt_tokens: promptTokens, completion_tokens: 20, total_tokens: promptTokens + 20},
    },
  ]
}

const CONTINUE_ARGS = {
  reason: 'topic_change',
  title: 'Plan the Lisbon offsite',
  description: 'Booking venue and agenda for the October offsite.',
  handoff: {
    purpose: 'Organize the October team offsite in Lisbon.',
    currentRequest: 'The user wants to start planning the Lisbon offsite now.',
    establishedFacts: ['Team is 12 people', 'Budget is 20k EUR'],
    decisions: ['Lisbon over Porto because of flight availability'],
    nextActions: ['Shortlist three venues', 'Draft a two-day agenda'],
  },
  sources: [
    {kind: 'resource', url: 'hm://z6MkTest/notes', relevance: 'agenda draft'},
    // No sessionId: the range is of the session being continued.
    {kind: 'session_events', fromSeq: 1, toSeq: 1, relevance: 'the opening question'},
  ],
}

/**
 * The canned provider. Bodies are inspected, never parsed as a real client would: the first
 * request that is not a successor turn and mentions Lisbon continues; a successor turn first tries
 * to continue AGAIN (which the loop guard must refuse) and then answers; everything else is small
 * talk with a stamped usage so the next turn carries a <context_usage> block.
 */
function installProvider(): {requests: string[]} {
  const requests: string[] = []
  let successorAttempts = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    requests.push(body)
    if (body.includes('<session_continuation>')) {
      successorAttempts += 1
      if (successorAttempts === 1) {
        return sse(toolCallReply('chat-loop', 'call_cont_2', 'continue_session', CONTINUE_ARGS, 3_000))
      }
      return sse(textReply('chat-successor', 'Answering in the successor.', 3_200))
    }
    if (body.includes('Lisbon')) {
      return sse(toolCallReply('chat-continue', 'call_cont_1', 'continue_session', CONTINUE_ARGS, 90_000))
    }
    return sse(textReply('chat-small', 'Sure, the venue survey is done.', 1_000))
  }) as unknown as typeof fetch
  cleanups.push(() => {
    globalThis.fetch = originalFetch
  })
  return {requests}
}

async function until<T>(read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('condition never held')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function eventsOf(response: api.AgentResponse): Array<api.SessionEvent & {event: Record<string, unknown>}> {
  if (response._ !== 'GetSessionResponse') throw new Error(`unexpected: ${response._}`)
  return response.events as never
}

describe('continue_session', () => {
  test('carries the conversation into a titled successor that answers, leaving the predecessor intact', async () => {
    const harness = await createHarness()
    const provider = installProvider()
    const created = await harness.send({_: 'CreateSession', agentId: harness.agentId})
    if (created._ !== 'CreateSessionResponse') throw new Error('unexpected response')
    const predecessorId = created.sessionId

    // An ordinary first turn, so the projection has recent exchanges to excerpt and the next turn
    // has a measured context.
    const first = await harness.send({
      _: 'MessageSession',
      sessionId: predecessorId,
      content: [{type: 'text', text: 'How is the venue survey going?'}],
    })
    if (first._ !== 'MessageSessionResponse') throw new Error('unexpected response')
    expect(first.assistantEventId).not.toBe('')
    expect(first.continuedToSessionId).toBeUndefined()

    const switching = "Actually, let's switch to planning the Lisbon offsite instead."
    const second = await harness.send({
      _: 'MessageSession',
      sessionId: predecessorId,
      content: [{type: 'text', text: switching}],
    })
    if (second._ !== 'MessageSessionResponse') throw new Error('unexpected response')
    expect(second.continuedToSessionId).toBeTruthy()
    const successorId = second.continuedToSessionId!
    await harness.service.drainTriggerSessions()

    // The predecessor's second request was measured: its earlier turn stamped usage.
    const secondRequest = provider.requests.find(
      (body) => body.includes('Lisbon') && !body.includes('<session_continuation>'),
    )
    expect(secondRequest).toBeDefined()
    expect(secondRequest).toContain('<context_usage tokens=')
    expect(secondRequest).toContain('continue_session')

    // Exactly one edge, despite the successor's own attempt to continue again.
    const edges = harness.db
      .query<{id: string; manifest_cbor: Uint8Array; reason: string; successor_session_id: string}, [string]>(
        `SELECT id, manifest_cbor, reason, successor_session_id FROM session_continuations WHERE predecessor_session_id = ?`,
      )
      .all(predecessorId)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.successor_session_id).toBe(successorId)
    expect(harness.db.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM session_continuations`).get()?.n).toBe(1)
    const manifest = cborDecode<api.SessionContinuationManifest>(edges[0]!.manifest_cbor)
    expect(manifest.compiler).toBe('projection/1')
    expect(manifest.predecessorSessionId).toBe(predecessorId)
    expect(manifest.successorSessionId).toBe(successorId)
    expect(manifest.originSessionId).toBe(predecessorId)
    expect(manifest.reason).toBe('topic_change')
    expect(manifest.toolCallId).toBe('call_cont_1')
    expect(manifest.handoff.purpose).toBe(CONTINUE_ARGS.handoff.purpose)
    expect(manifest.initiatingEvent.seq).toBeGreaterThan(0)
    expect(manifest.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'resource', url: 'hm://z6MkTest/notes'}),
        expect.objectContaining({kind: 'session_events', sessionId: predecessorId, fromSeq: 1, toSeq: 1}),
        expect.objectContaining({kind: 'session_event', sessionId: predecessorId, seq: manifest.initiatingEvent.seq}),
        expect.objectContaining({kind: 'session_events', sessionId: predecessorId}),
      ]),
    )
    expect(manifest.included.length).toBeGreaterThan(0)
    expect(manifest.omitted).toEqual([])
    expect(manifest.transfer).toEqual({plan: 'omit'})
    expect(manifest.projectionBytes).toBeGreaterThan(0)

    // Predecessor: complete transcript plus the edge.
    const predecessor = await harness.send({_: 'GetSession', sessionId: predecessorId})
    if (predecessor._ !== 'GetSessionResponse') throw new Error('unexpected response')
    expect(predecessor.session.continuedTo).toMatchObject({
      continuationId: edges[0]!.id,
      sessionId: successorId,
      title: 'Plan the Lisbon offsite',
      reason: 'topic_change',
    })
    expect(predecessor.session.continuedFrom).toBeUndefined()
    const predecessorEvents = eventsOf(predecessor)
    const initiating = predecessorEvents.find(
      (event) => event.event.type === 'message' && event.event.content === switching,
    )
    expect(initiating).toBeDefined()
    expect(initiating!.seq).toBe(manifest.initiatingEvent.seq)
    expect(initiating!.id).toBe(manifest.initiatingEvent.id)
    const call = predecessorEvents.find(
      (event) => event.event.type === 'tool_call' && event.event.name === 'continue_session',
    )
    expect(call).toBeDefined()
    expect(call!.event.id).toBe('call_cont_1')
    const result = predecessorEvents.find(
      (event) => event.event.type === 'tool_result' && event.event.toolCallId === 'call_cont_1',
    )
    expect(result).toBeDefined()
    expect(result!.event.error).toBeUndefined()
    expect(result!.event.output).toMatchObject({successorSessionId: successorId, continuationId: edges[0]!.id})
    // The earlier plain turn is still there, untouched.
    expect(
      predecessorEvents.some(
        (event) => event.event.type === 'message' && event.event.content === 'Sure, the venue survey is done.',
      ),
    ).toBe(true)

    // Successor: named by the predecessor, opened by the projection and the exact user message.
    const successor = await harness.send({_: 'GetSession', sessionId: successorId})
    if (successor._ !== 'GetSessionResponse') throw new Error('unexpected response')
    expect(successor.session.title).toBe('Plan the Lisbon offsite')
    expect(successor.session.description).toBe('Booking venue and agenda for the October offsite.')
    expect(successor.session.parentSessionId).toBeUndefined()
    expect(successor.session.continuedFrom).toMatchObject({
      continuationId: edges[0]!.id,
      sessionId: predecessorId,
      reason: 'topic_change',
    })
    expect(successor.session.continuedTo).toBeUndefined()
    expect(successor.contextWindow).toBe(128_000)
    expect(
      harness.db
        .query<{title_source: string}, [string]>(`SELECT title_source FROM sessions WHERE id = ?`)
        .get(successorId)?.title_source,
    ).toBe('agent')
    const successorEvents = eventsOf(successor)
    const opening = successorEvents[0]!.event
    expect(opening).toMatchObject({type: 'message', role: 'user', actor: 'system'})
    const projection = String(opening.content)
    expect(projection).toContain('<session_continuation>')
    expect(projection).toContain(`<predecessor session="${predecessorId}"`)
    expect(projection).toContain(`<origin session="${predecessorId}"`)
    expect(projection).toContain(`read thread:${predecessorId}`)
    expect(projection).toContain('<handoff>')
    expect(projection).toContain(CONTINUE_ARGS.handoff.purpose)
    expect(projection).toContain('Budget is 20k EUR')
    expect(projection).toContain('hm://z6MkTest/notes')
    // The cited range was loaded as an exact excerpt, and the manifest says so.
    expect(projection).toContain('<excerpt thread="' + predecessorId + '" from_seq="1" to_seq="1"')

    expect(projection).toContain('<recent_exchanges')
    expect(projection).toContain('How is the venue survey going?')
    // The initiating message is not excerpted — it is replayed as its own event next.
    expect(projection).not.toContain(switching)
    const replayed = successorEvents[1]!.event
    expect(replayed).toMatchObject({type: 'message', role: 'user', content: switching})
    expect(replayed.meta).toMatchObject({
      continuedFrom: {sessionId: predecessorId, eventId: initiating!.id, seq: initiating!.seq},
    })

    // The successor tried to continue again with no new user message: refused, then it answered.
    const settled = await until(() => {
      const rows = harness.db
        .query<{event_cbor: Uint8Array}, [string]>(
          `SELECT event_cbor FROM session_events WHERE session_id = ? ORDER BY seq ASC`,
        )
        .all(successorId)
        .map((row) => cborDecode<Record<string, unknown>>(row.event_cbor))
      return rows.some((event) => event.type === 'message' && event.content === 'Answering in the successor.')
        ? rows
        : undefined
    })
    const refused = settled.find((event) => event.type === 'tool_result' && event.toolCallId === 'call_cont_2')
    expect(refused).toBeDefined()
    expect(String(refused!.error)).toContain('would loop')
    expect(harness.db.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM session_continuations`).get()?.n).toBe(1)
    const successorRequest = provider.requests.find((body) => body.includes('<session_continuation>'))
    expect(successorRequest).toBeDefined()
    expect(successorRequest).toContain(switching)

    // Both are foreground conversations in the list.
    const listed = await harness.send({_: 'ListSessions', agentId: harness.agentId})
    if (listed._ !== 'ListSessionsResponse') throw new Error('unexpected response')
    const ids = listed.sessions.map((session: api.SessionInfo) => session.id)
    expect(ids).toContain(predecessorId)
    expect(ids).toContain(successorId)
    const listedPredecessor = listed.sessions.find((session: api.SessionInfo) => session.id === predecessorId)
    expect(listedPredecessor?.continuedTo?.sessionId).toBe(successorId)
  })

  test('a call with a bogus reason is refused and the turn stays in this session', async () => {
    const harness = await createHarness()
    const requests: string[] = []
    let calls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(init?.body ?? ''))
      calls += 1
      if (calls === 1) {
        return sse(
          toolCallReply('chat-bogus', 'call_bogus', 'continue_session', {...CONTINUE_ARGS, reason: 'bogus'}, 500),
        )
      }
      return sse(textReply('chat-after', 'Staying here then.', 600))
    }) as unknown as typeof fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    const created = await harness.send({_: 'CreateSession', agentId: harness.agentId})
    if (created._ !== 'CreateSessionResponse') throw new Error('unexpected response')
    const response = await harness.send({
      _: 'MessageSession',
      sessionId: created.sessionId,
      content: [{type: 'text', text: 'Move on please.'}],
    })
    if (response._ !== 'MessageSessionResponse') throw new Error('unexpected response')
    expect(response.continuedToSessionId).toBeUndefined()
    expect(response.assistantEventId).not.toBe('')
    const session = await harness.send({_: 'GetSession', sessionId: created.sessionId})
    const events = eventsOf(session)
    const refused = events.find(
      (event) => event.event.type === 'tool_result' && event.event.toolCallId === 'call_bogus',
    )
    expect(refused).toBeDefined()
    expect(String(refused!.event.error)).toContain('reason')
    expect(events.some((event) => event.event.type === 'message' && event.event.content === 'Staying here then.')).toBe(
      true,
    )
    expect(harness.db.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM session_continuations`).get()?.n).toBe(0)
  })
})
