import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as piAi from '@earendil-works/pi-ai'
import * as durable from '@earendil-works/pi-durable'
import * as apisvc from '@/api-service'
import type * as api from '@/api'
import * as blobs from '@shm/shared/blobs'
import {serialize} from 'superjson'
import {unpackHmId} from '@seed-hypermedia/client'
import * as durableSession from '@/durable-session'
import * as effectOutbox from '@/effect-outbox'
import * as sqlite from '@/sqlite'
import * as cbor from '@/cbor'

/**
 * The durable session runtime end to end: every session keeps one Pi Durable conversation that its
 * turns append to, stored in the agents database; the Seed log and that conversation stay in step
 * from both sides; a turn cut off by a process death continues from its last checkpoint; and a
 * store that is lost is rebuilt from the log. Driven through the real run queue with a canned
 * provider.
 */

const cleanups: Array<() => void> = []
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  while (cleanups.length) cleanups.pop()?.()
})

type TestSession = {
  db: Database
  dataDir: string
  account: ReturnType<typeof blobs.generateNobleKeyPair>
  service: apisvc.Service
  send: (action: unknown) => Promise<api.AgentResponse>
  agentId: string
  sessionId: string
}

async function createSession(
  options: {model?: string; onEvent?: (event: apisvc.ServiceEvent) => void} = {},
): Promise<TestSession> {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-session-test-'))
  const account = blobs.generateNobleKeyPair()
  const service = new apisvc.Service(db, dataDir, {onEvent: options.onEvent})
  const send = async (action: unknown) =>
    service.message(await apisvc.createSignedEnvelope(account, {action: action as never}))
  await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
  const agent = await send({
    _: 'CreateAgent',
    definition: {
      name: 'Durable',
      systemPrompt: 'be terse',
      modelProvider: 'openai',
      model: options.model ?? 'gpt-test',
    },
  })
  if (agent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  const session = await send({_: 'CreateSession', agentId: agent.agentId})
  if (session._ !== 'CreateSessionResponse') throw new Error('unexpected response')
  cleanups.push(() => {
    service.stopRunQueue()
    sqlite.closeDatabase(db)
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  return {
    db,
    dataDir,
    account,
    service,
    send,
    agentId: agent.agentId,
    sessionId: session.sessionId,
  }
}

type ChatMessage = {role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string}

function sse(chunks: unknown[]): Response {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: {'content-type': 'text/event-stream'},
  })
}

function textReply(id: string, text: string): Response {
  return sse([
    {id, choices: [{index: 0, delta: {role: 'assistant', content: text}}]},
    {
      id,
      choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 7, completion_tokens: 3, total_tokens: 10},
    },
  ])
}

function toolCallReply(id: string, callId: string, name: string, args: unknown): Response {
  return sse([
    {
      id,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: 'Reading it.',
            tool_calls: [{index: 0, id: callId, type: 'function', function: {name, arguments: JSON.stringify(args)}}],
          },
        },
      ],
    },
    {
      id,
      choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}],
      usage: {prompt_tokens: 7, completion_tokens: 9, total_tokens: 16},
    },
  ])
}

/** A Seed API `Resource` response for a one-paragraph document at `hm://z6Mkdoc/notes`. */
function notesDocumentResponse(): Response {
  return Response.json(
    serialize({
      type: 'document',
      id: unpackHmId('hm://z6Mkdoc/notes'),
      document: {
        content: [{block: {id: 'b1', type: 'Paragraph', text: 'Durable notes'}, children: []}],
        version: 'v1',
        account: 'z6Mkdoc',
        authors: [],
        path: '/notes',
        createTime: '',
        updateTime: '',
        metadata: {name: 'Notes'},
        genesis: 'genesis',
        visibility: 'PUBLIC',
      },
    }),
  )
}

/** The provider requests a mocked fetch saw, as their chat messages. */
function providerMessages(init: RequestInit | undefined): ChatMessage[] {
  return (JSON.parse(String(init?.body)) as {messages: ChatMessage[]}).messages
}

type StoreRow = {session_id: string; file: string; seq: number; data: Uint8Array}

/** The rows that hold a session's durable store. */
function storeRows(h: TestSession): StoreRow[] {
  return h.db
    .query<StoreRow, [string]>(`SELECT session_id, file, seq, data FROM session_durable_files WHERE session_id = ?`)
    .all(h.sessionId)
}

/** Loses a session's durable store, as a restored backup or a failed disk would. */
function dropStore(h: TestSession): void {
  h.db.run(`DELETE FROM session_durable_files WHERE session_id = ?`, [h.sessionId])
}

/** The entries of a session's durable conversation, read from its store. */
async function durableEntries(h: TestSession): Promise<durable.EntryRecord[]> {
  const harness = await durableSession.openSessionHarness({
    db: h.db,
    sessionId: h.sessionId,
    models: piAi.createModels(),
    registry: durable.createRegistry(),
    onReport: () => {},
  })
  try {
    const root = await harness.root(durableSession.CONTEXT)
    const page = await root.entries({}, 1000, undefined, durableSession.CONTEXT)
    return [...page.items].sort((a, b) => a.id - b.id)
  } finally {
    await harness.close(durableSession.CONTEXT)
  }
}

function eventRows(db: Database, sessionId: string): {type: string; role?: string; entry: number | null}[] {
  return db
    .query<{event_cbor: Uint8Array; pi_entry_id: number | null}, [string]>(
      `SELECT event_cbor, pi_entry_id FROM session_events WHERE session_id = ? ORDER BY seq ASC`,
    )
    .all(sessionId)
    .map((row) => {
      const event = cbor.decode<{type: string; role?: string}>(row.event_cbor)
      return {type: event.type, ...(event.role ? {role: event.role} : {}), entry: row.pi_entry_id}
    })
}

describe('durable sessions', () => {
  test('a competing service boot cannot reopen a journal while its provider request is in flight', async () => {
    const h = await createSession()
    const started = Promise.withResolvers<void>()
    const reply = Promise.withResolvers<Response>()
    let requests = 0
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url)
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      requests += 1
      if (requests === 1) {
        started.resolve()
        return reply.promise
      }
      return textReply('contender', 'A second runtime must not request this answer.')
    }) as unknown as typeof fetch
    const active = h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Hello'}]})
    await started.promise

    // Hot reload used to construct another Service before binding its HTTP port. Its boot sweep
    // requeues this still-live run; without the writer guard, Pi resumes its task and two runtime
    // instances append commits with independently cached sequence numbers to the same journal.
    const contender = new apisvc.Service(h.db, h.dataDir, {})
    cleanups.push(() => contender.stopRunQueue())
    try {
      await contender.awaitQueueIdle()
      expect(requests).toBe(1)
      const run = h.db
        .query<{error_cbor: Uint8Array}, [string]>('SELECT error_cbor FROM runs WHERE session_id = ?')
        .get(h.sessionId)
      expect(cbor.decode<{message: string}>(run!.error_cbor).message).toContain('already open')
    } finally {
      reply.resolve(textReply('original', 'Hello'))
      // The boot sweep still changes the run record, so the original caller can see the
      // contender's error. Here we verify the narrower journal-ownership guarantee.
      await active.catch(() => {})
    }

    const main = Buffer.concat(
      storeRows(h)
        .filter((row) => row.file === 'main.jsonl')
        .sort((a, b) => a.seq - b.seq)
        .map((row) => row.data),
    )
      .toString()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {seq: number})
    expect(main.map((marker) => marker.seq)).toEqual(main.map((_, index) => index + 1))
    await durableEntries(h)
    expect(storeRows(h).some((row) => row.file.startsWith('recovery-'))).toBe(false)
  })

  test('a session appends its turns to one durable conversation and keeps the prompt prefix byte-stable', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply(`chat-${requests.length}`, `Answer ${requests.length}`)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'First question'}]})
    // The clock moves between turns and so does the agent's Space; nothing the model already read
    // may change because of either.
    await Bun.sleep(5)
    await h.send({_: 'WriteAgentMemoryFile', agentId: h.agentId, path: 'notes/new.md', content: 'hello'})
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Second question'}]})

    expect(requests).toHaveLength(2)
    const [first, second] = requests as [ChatMessage[], ChatMessage[]]
    // The system prompt carries no clock, so the second request repeats it byte for byte and the
    // provider's prompt cache holds across turns.
    expect(second[0]).toEqual(first[0])
    expect(String(first[0]?.content)).not.toContain('The current time is')
    // The second turn reads the first turn as it happened, then its own input and state blocks.
    const transcript = second.slice(1).map((message) => `${message.role}:${String(message.content)}`)
    expect(transcript[0]).toStartWith('user:')
    expect(transcript[0]).toContain('First question')
    expect(transcript[1]).toBe('assistant:Answer 1')
    expect(transcript[2]).toContain('Second question')
    // Per-turn state rides behind each turn's own input and is never stored: one Space index and
    // one clock per request, each as things stand when the turn starts.
    const spaces = second.filter((message) => String(message.content).startsWith('<space>'))
    expect(spaces).toHaveLength(1)
    expect(String(spaces[0]?.content)).toContain('notes/(1)')
    expect(String(first.find((message) => String(message.content).startsWith('<space>'))?.content)).toContain(
      'memory/ — empty',
    )
    expect(second.filter((message) => String(message.content).startsWith('<current_time>'))).toHaveLength(1)
    expect(String(second.at(-1)?.content)).toStartWith('<current_time>')

    // What the harness produced is marked with the entry it came from; what users wrote is not.
    const rows = eventRows(h.db, h.sessionId).filter((row) => row.type === 'message')
    expect(rows.map((row) => row.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(rows[0]?.entry).toBeNull()
    expect(rows[2]?.entry).toBeNull()
    expect(rows[1]?.entry).toBeGreaterThan(0)
    expect(rows[3]?.entry).toBeGreaterThan(rows[1]?.entry ?? 0)

    // One store, one conversation: the first turn filled it from the log behind a head, the second
    // only appended. The provider's own messages are kept exactly, usage included.
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
    const answers = entries.filter((entry) => durable.AssistantEntry.is(entry))
    expect(answers).toHaveLength(2)
    const answer = answers[0]?.model?.[0]
    if (answer?.role !== 'assistant') throw new Error('expected an assistant message')
    expect(answer.provider).toBe('openai')
    expect(answer.model).toBe('gpt-test')
    expect(answer.usage.input + answer.usage.output).toBeGreaterThan(0)
    expect(Number(answers[1]?.id)).toBe(rows[3]?.entry ?? -1)
  })

  test('a turn cut off by a process death continues from its checkpoint in the next process', async () => {
    const h = await createSession()
    const providerRequests: ChatMessage[][] = []
    let resourceReads = 0
    let markToolStarted = () => {}
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve
    })
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (href.includes('/api/Resource')) {
        resourceReads += 1
        if (resourceReads === 1) {
          // The process dies while this read is in flight: it never returns.
          markToolStarted()
          return new Promise<Response>(() => {})
        }
        return notesDocumentResponse()
      }
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      providerRequests.push(providerMessages(init))
      return providerRequests.length === 1
        ? toolCallReply('chat-1', 'call-read', 'read', {address: 'hm://z6Mkdoc/notes'})
        : textReply('chat-2', 'It says: Durable notes.')
    }) as unknown as typeof fetch

    // The first process answers with a tool call, starts the read, and dies mid-call. Its request
    // promise never settles; nothing is awaited on it.
    void h
      .send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'What do the notes say?'}]})
      .catch(() => {})
    await toolStarted
    h.service.stopRunQueue()
    expect(providerRequests).toHaveLength(1)
    const beforeRestart = eventRows(h.db, h.sessionId)
    expect(beforeRestart.map((row) => row.type)).toEqual(['message', 'message', 'tool_call'])

    // A real process death loses its open handles. Give the restarted process an independent
    // connection with exactly the persisted bytes, so the intentionally hung old task cannot write to it.
    h.db = Database.deserialize(h.db.serialize())
    if (!sqlite.openWithDatabase(h.db).ok) throw new Error('unexpected schema mismatch')
    cleanups.push(() => sqlite.closeDatabase(h.db))
    const restarted = new apisvc.Service(h.db, h.dataDir, {})
    cleanups.push(() => restarted.stopRunQueue())
    await restarted.awaitQueueIdle()

    // The model's first response was already committed: it is not requested again. The read is
    // replay-safe, so it simply ran again, and the turn went on to its answer.
    expect(providerRequests).toHaveLength(2)
    expect(resourceReads).toBeGreaterThan(1)
    const followUp = providerRequests[1] ?? []
    const toolResult = followUp.find((message) => message.role === 'tool')
    expect(toolResult?.tool_call_id).toBe('call-read')
    expect(String(toolResult?.content)).toContain('Durable notes')

    const session = await restarted.message(
      await apisvc.createSignedEnvelope(h.account, {action: {_: 'GetSession', sessionId: h.sessionId}}),
    )
    if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
    expect(session.session.status).toBe('idle')
    const events = session.events.map((event) => event.event as {type: string; content?: string; error?: string})
    // Nothing was written twice, and nothing was reported as interrupted.
    expect(events.map((event) => event.type)).toEqual(['message', 'message', 'tool_call', 'tool_result', 'message'])
    expect(events[3]?.error).toBeUndefined()
    expect(events[4]?.content).toBe('It says: Durable notes.')
    const run = h.db.query<{status: string}, [string]>(`SELECT status FROM runs WHERE session_id = ?`).get(h.sessionId)
    expect(run?.status).toBe('succeeded')
  })

  test('a lost durable store is rebuilt from the log on the next turn', async () => {
    const streamed: string[] = []
    const h = await createSession({
      onEvent: (event) => {
        if (event.type === 'session-partial' && event.textDelta) streamed.push(event.textDelta)
      },
    })
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply(`chat-${requests.length}`, `Answer ${requests.length}`)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'First question'}]})
    expect(storeRows(h).length).toBeGreaterThan(0)
    dropStore(h)
    streamed.length = 0
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Second question'}]})

    // Replaying the first answer into the new store is preparation, not this turn's output: only
    // the new answer is streamed.
    expect(streamed.join('')).toBe('Answer 2')

    // The log is the record: the new store's context was filled from it, so the model still reads
    // the whole conversation.
    const second = (requests[1] ?? []).slice(1).map((message) => String(message.content))
    expect(second[0]).toContain('First question')
    expect(second[1]).toBe('Answer 1')
    expect(second[2]).toContain('Second question')
    // Entry ids of the lost store mean nothing to the new one: only this turn's answer is marked.
    const rows = eventRows(h.db, h.sessionId).filter((row) => row.type === 'message')
    expect(rows.map((row) => row.entry === null)).toEqual([true, true, true, false])
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.AssistantEntry.is(entry))).toHaveLength(1)
    expect(entries.filter((entry) => durableSession.ReplayEntry.is(entry)).length).toBeGreaterThanOrEqual(2)
  })

  test('a store that lost its newest commits catches up from the log', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply(`chat-${requests.length}`, `Answer ${requests.length}`)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'First question'}]})
    // A store can end up older than the log (its rows restored from an earlier copy): roll it
    // back to how it stood after the first turn.
    const snapshot = storeRows(h)
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Second question'}]})
    dropStore(h)
    for (const row of snapshot) {
      h.db.run(`INSERT INTO session_durable_files (session_id, file, seq, data) VALUES (?, ?, ?, ?)`, [
        row.session_id,
        row.file,
        row.seq,
        row.data,
      ])
    }

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Third question'}]})

    // The third turn still reads the second, which only the log remembered, and its own answer is
    // written to the log even though the store handed out entry ids the log had seen before.
    const third = (requests[2] ?? []).slice(1).map((message) => `${message.role}:${String(message.content)}`)
    expect(third.filter((line) => line.includes('Second question'))).toHaveLength(1)
    expect(third).toContain('assistant:Answer 2')
    expect(third.findIndex((line) => line.includes('Third question'))).toBeGreaterThan(
      third.indexOf('assistant:Answer 2'),
    )
    const messages = eventRows(h.db, h.sessionId).filter((row) => row.type === 'message')
    expect(messages.map((row) => row.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    // The second answer is no longer tied to an entry; the first and third are.
    expect(messages.map((row) => row.entry !== null)).toEqual([false, true, false, false, false, true])
  })

  test('a retry after a provider failure mid-turn continues from the tool results it already has', async () => {
    const h = await createSession()
    const providerRequests: ChatMessage[][] = []
    let resourceReads = 0
    let providerHealthy = false
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (href.includes('/api/Resource')) {
        resourceReads += 1
        return notesDocumentResponse()
      }
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      providerRequests.push(providerMessages(init))
      if (providerRequests.length === 1) {
        return toolCallReply('chat-1', 'call-read', 'read', {address: 'hm://z6Mkdoc/notes'})
      }
      return providerHealthy ? textReply('chat-ok', 'It says: Durable notes.') : new Response('boom', {status: 500})
    }) as unknown as typeof fetch

    // The model reads the document, then the provider fails for good (every client-side retry too).
    await expect(
      h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'What do the notes say?'}]}),
    ).rejects.toThrow()
    const readsBeforeRetry = resourceReads
    const requestsBeforeRetry = providerRequests.length

    providerHealthy = true
    const retried = await h.send({_: 'RetrySession', sessionId: h.sessionId})
    expect(retried._).toBe('RetrySessionResponse')

    // The retry asks the model once, with the call and its result in place, and says why it is
    // being asked again. The read itself is not repeated.
    expect(providerRequests).toHaveLength(requestsBeforeRetry + 1)
    expect(resourceReads).toBe(readsBeforeRetry)
    const retry = providerRequests.at(-1) ?? []
    const toolResult = retry.find((message) => message.role === 'tool')
    expect(toolResult?.tool_call_id).toBe('call-read')
    expect(String(toolResult?.content)).toContain('Durable notes')
    expect(retry.filter((message) => String(message.content).includes('What do the notes say?'))).toHaveLength(1)
    expect(retry.some((message) => String(message.content).startsWith('<turn_resumed>'))).toBe(true)
    expect(JSON.stringify(retry)).not.toContain('boom')
    const types = eventRows(h.db, h.sessionId).map((row) => row.type)
    expect(types).toEqual(['message', 'message', 'tool_call', 'tool_result', 'error', 'message'])
  })

  test('retry archives a corrupt journal and restores history without repeating completed tools', async () => {
    const h = await createSession()
    const providerRequests: ChatMessage[][] = []
    let resourceReads = 0
    let providerHealthy = false
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (href.includes('/api/Resource')) {
        resourceReads += 1
        return notesDocumentResponse()
      }
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      providerRequests.push(providerMessages(init))
      if (providerRequests.length === 1) {
        return toolCallReply('chat-1', 'call-read', 'read', {address: 'hm://z6Mkdoc/notes'})
      }
      return providerHealthy ? textReply('chat-ok', 'It says: Durable notes.') : new Response('boom', {status: 500})
    }) as unknown as typeof fetch

    // The model reads the document, then the provider fails for good (every client-side retry too).
    await expect(
      h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'What do the notes say?'}]}),
    ).rejects.toThrow()
    const readsBeforeRetry = resourceReads
    const requestsBeforeRetry = providerRequests.length

    const files = durableSession.sessionFileSystem(h.db, h.sessionId)
    await files.appendFile(
      'main.jsonl',
      JSON.stringify({format: 1, type: 'commit', seq: 1, writes: []}) + '\n',
      durableSession.CONTEXT,
    )
    const originalRows = storeRows(h)
    const beforeEvents = h.db
      .query<{id: string; event_cbor: Uint8Array}, [string]>(
        'SELECT id, event_cbor FROM session_events WHERE session_id = ? ORDER BY seq',
      )
      .all(h.sessionId)
    providerHealthy = true
    const retried = await h.send({_: 'RetrySession', sessionId: h.sessionId})
    expect(retried._).toBe('RetrySessionResponse')

    // The retry asks the model once, with the call and its result in place, and says why it is
    // being asked again. The read itself is not repeated.
    expect(providerRequests).toHaveLength(requestsBeforeRetry + 1)
    expect(resourceReads).toBe(readsBeforeRetry)
    const retry = providerRequests.at(-1) ?? []
    const toolResult = retry.find((message) => message.role === 'tool')
    expect(toolResult?.tool_call_id).toBe('call-read')
    expect(String(toolResult?.content)).toContain('Durable notes')
    expect(retry.filter((message) => String(message.content).includes('What do the notes say?'))).toHaveLength(1)
    expect(JSON.stringify(retry)).not.toContain('boom')
    const types = eventRows(h.db, h.sessionId).map((row) => row.type)
    expect(types).toEqual(['message', 'message', 'tool_call', 'tool_result', 'error', 'message'])
    const archives = storeRows(h).filter((row) => row.file.startsWith('recovery-'))
    expect(
      archives
        .map((row) => ({...row, file: row.file.slice(row.file.indexOf('/') + 1)}))
        .sort((a, b) => a.file.localeCompare(b.file) || a.seq - b.seq),
    ).toEqual(originalRows.sort((a, b) => a.file.localeCompare(b.file) || a.seq - b.seq))
    expect(
      h.db
        .query<{id: string; event_cbor: Uint8Array}, [string]>(
          'SELECT id, event_cbor FROM session_events WHERE session_id = ? ORDER BY seq',
        )
        .all(h.sessionId)
        .slice(0, beforeEvents.length),
    ).toEqual(beforeEvents)
    await durableEntries(h)
    expect(storeRows(h).filter((row) => row.file.startsWith('recovery-'))).toHaveLength(archives.length)
  })

  test('stopping a streaming turn keeps the text that was already streamed', async () => {
    let markStreaming = () => {}
    const streaming = new Promise<void>((resolve) => {
      markStreaming = resolve
    })
    const h = await createSession({
      onEvent: (event) => {
        if (event.type === 'session-partial' && event.textDelta) markStreaming()
      },
    })
    globalThis.fetch = mock(async () => {
      const first = {id: 'chat-1', choices: [{index: 0, delta: {role: 'assistant', content: 'The long answer begins'}}]}
      // The response stays open: more text is always about to arrive.
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(first)}\n\n`)),
      })
      return new Response(body, {headers: {'content-type': 'text/event-stream'}})
    }) as unknown as typeof fetch

    const turn = h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Explain'}]})
    await streaming
    const stopped = await h.send({_: 'StopSession', sessionId: h.sessionId})
    expect(stopped).toMatchObject({_: 'StopSessionResponse', stopped: true})
    await turn.catch(() => {})

    const session = await h.send({_: 'GetSession', sessionId: h.sessionId})
    if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
    expect(session.session.status).toBe('idle')
    const messages = session.events
      .map((event) => event.event as {type: string; role?: string; content?: string})
      .filter((event) => event.type === 'message' && event.role === 'assistant')
    expect(messages.map((message) => message.content)).toEqual(['The long answer begins'])

    // The next turn appends to the same conversation, and the model reads what it had said before
    // it was stopped, as the person did.
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply('chat-2', 'Short answer.')
    }) as unknown as typeof fetch
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Shorter please'}]})
    const next = (requests[0] ?? []).slice(1).map((message) => String(message.content))
    const explainAt = next.findIndex((content) => content.includes('Explain'))
    expect(explainAt).toBeGreaterThan(-1)
    expect(next[explainAt + 1]).toBe('The long answer begins')
    expect(next.findIndex((content) => content.includes('Shorter please'))).toBeGreaterThan(explainAt + 1)
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
  })

  test('deleting a session under a streaming turn ends the turn instead of leaving it running', async () => {
    let markStreaming = () => {}
    const streaming = new Promise<void>((resolve) => {
      markStreaming = resolve
    })
    const h = await createSession({
      onEvent: (event) => {
        if (event.type === 'session-partial' && event.textDelta) markStreaming()
      },
    })
    globalThis.fetch = mock(async () => {
      const first = {id: 'chat-1', choices: [{index: 0, delta: {role: 'assistant', content: 'The long answer begins'}}]}
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(first)}\n\n`)),
      })
      return new Response(body, {headers: {'content-type': 'text/event-stream'}})
    }) as unknown as typeof fetch

    const turn = h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Explain'}]})
    await streaming
    // The session's rows go at once; the turn's own abort then finds its store gone.
    await h.send({_: 'DeleteSession', sessionId: h.sessionId})
    await turn.catch(() => {})
    await h.service.awaitQueueIdle()

    const statuses = h.db.query<{status: string}, []>(`SELECT status FROM runs`).all()
    expect(statuses.map((row) => row.status)).toEqual(['canceled'])
    expect(storeRows(h)).toHaveLength(0)
  })

  test('an image a tool showed the model stays out of the store and out of later turns', async () => {
    const h = await createSession({model: 'gpt-4o'})
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const imageBase64 = Buffer.from(image).toString('base64')
    const uploaded = await h.send({
      _: 'UploadSessionAttachment',
      sessionId: h.sessionId,
      name: 'pixel.png',
      mimeType: 'image/png',
      content: image,
    })
    if (uploaded._ !== 'UploadSessionAttachmentResponse') throw new Error('unexpected response')
    const attachmentId = uploaded.attachment.id

    const requestBodies: string[] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(String(init?.body))
      if (requestBodies.length === 1) {
        return toolCallReply('chat-1', 'call-look', 'read', {address: `attachment:${attachmentId}`})
      }
      return textReply(`chat-${requestBodies.length}`, `Answer ${requestBodies.length}`)
    }) as unknown as typeof fetch

    await h.send({
      _: 'MessageSession',
      sessionId: h.sessionId,
      content: [
        {type: 'text', text: 'What is in this picture?'},
        {type: 'attachment', id: attachmentId},
      ],
    })
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Thanks'}]})

    expect(requestBodies).toHaveLength(3)
    // The request that follows the read carries the image; the next turn carries only the text
    // of that result, and the store never held the bytes.
    expect(requestBodies[1]).toContain(imageBase64)
    expect(requestBodies[2]).not.toContain(imageBase64)
    expect(requestBodies[2]).toContain('call-look')
    const stored = storeRows(h)
      .map((row) => new TextDecoder().decode(row.data))
      .join('')
    expect(stored).toContain('call-look')
    expect(stored).not.toContain(imageBase64)
  })

  test("a delegated child's result replaces its placeholder without rebuilding the conversation", async () => {
    const h = await createSession()
    const parentRequests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const messages = providerMessages(init)
      // The child carries the persona its parent gave it; the parent's prompt names none.
      if (String(messages[0]?.content).includes('You are the worker.')) return textReply('child', 'Worker finished.')
      parentRequests.push(messages)
      if (parentRequests.length === 1) {
        return toolCallReply('parent-1', 'spawn-1', 'delegate', {
          title: 'Worker',
          prompt: 'You are the worker.',
          brief: 'Do the task',
        })
      }
      return textReply(`parent-${parentRequests.length}`, 'All done.')
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Delegate the task'}]})
    await h.service.awaitQueueIdle()

    // The parent was asked twice: once before it parked, once with the child's real result sitting
    // directly behind the call that spawned it.
    expect(parentRequests).toHaveLength(2)
    const resumed = parentRequests[1] ?? []
    const resultAt = resumed.findIndex((message) => message.role === 'tool')
    expect(resumed[resultAt]?.tool_call_id).toBe('spawn-1')
    expect(String(resumed[resultAt]?.content)).toContain('Worker finished.')
    expect(String(resumed[resultAt]?.content)).not.toContain('Still running in the background')
    expect(resumed[resultAt - 1]?.role).toBe('assistant')
    expect(resumed.some((message) => String(message.content).startsWith('<background_work_update>'))).toBe(true)
    // Parking and resuming leaves the system prompt as it was: how many children are left is
    // state of the turn, not of the prompt.
    expect(resumed[0]).toEqual(parentRequests[0]?.[0])
    const budget = resumed.find((message) => String(message.content).startsWith('<delegation_budget>'))
    expect(String(budget?.content)).toContain('9 more children')
    expect(parentRequests[0]?.some((message) => String(message.content).startsWith('<delegation_budget>'))).toBe(false)

    // The conversation was filled from the log once, on its first turn, and never rebuilt: the
    // result arrived as an edit of the placeholder entry, and the response that made the call is
    // still the provider's own record of it.
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
    const edit = entries.find((entry) => entry.edits?.length)
    const placeholder = entries.find((entry) => entry.id === edit?.edits?.[0]?.target)
    const placeholderMessage = placeholder?.model?.[0]
    if (placeholderMessage?.role !== 'toolResult') throw new Error('expected the edit to target a tool result')
    expect(placeholderMessage.toolCallId).toBe('spawn-1')
    const call = entries.find((entry) => durable.AssistantEntry.is(entry))?.model?.[0]
    if (call?.role !== 'assistant') throw new Error('expected an assistant entry')
    expect(call.provider).toBe('openai')

    const session = await h.send({_: 'GetSession', sessionId: h.sessionId})
    if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
    const types = session.events.map((event) => (event.event as {type: string}).type)
    expect(types.filter((type) => type === 'tool_call')).toHaveLength(1)
    expect(types.filter((type) => type === 'tool_result')).toHaveLength(1)
    expect((session.events.at(-1)?.event as {content?: string}).content).toBe('All done.')
  })

  test('messages that queue up behind a turn are each answered once, in order', async () => {
    const h = await createSession()
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let markFirstStarted = () => {}
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      const call = requests.length
      if (call === 1) {
        markFirstStarted()
        await firstGate
      }
      return textReply(`chat-${call}`, `Answer ${call}`)
    }) as unknown as typeof fetch

    const first = h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Question one'}]})
    await firstStarted
    // Both follow-ups reach the log, in this order, before the first answer does.
    const userMessagesLogged = () =>
      eventRows(h.db, h.sessionId).filter((row) => row.type === 'message' && row.role === 'user').length
    const second = h.send({
      _: 'MessageSession',
      sessionId: h.sessionId,
      content: [{type: 'text', text: 'Question two'}],
    })
    while (userMessagesLogged() < 2) await Bun.sleep(1)
    const third = h.send({
      _: 'MessageSession',
      sessionId: h.sessionId,
      content: [{type: 'text', text: 'Question three'}],
    })
    while (userMessagesLogged() < 3) await Bun.sleep(1)
    releaseFirst()
    await Promise.all([first, second, third])
    await h.service.awaitQueueIdle()

    // Three messages, three provider requests. Each turn takes in its own message and leaves the
    // later one for the turn queued for it, so no question is put to the model twice.
    expect(requests).toHaveLength(3)
    const questions = (messages: ChatMessage[] | undefined) =>
      (messages ?? [])
        .filter((message) => message.role === 'user')
        .map((message) => String(message.content).match(/Question \w+/)?.[0])
        .filter(Boolean)
    expect(questions(requests[1])).toEqual(['Question one', 'Question two'])
    expect(questions(requests[2])).toEqual(['Question one', 'Question two', 'Question three'])
    const answers = (requests[2] ?? []).filter((message) => message.role === 'assistant')
    expect(answers.map((message) => message.content)).toEqual(['Answer 1', 'Answer 2'])
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
  })

  test('a message queued behind a turn that takes a second pass is put to the model once, by its own run', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let markSecondRequest = () => {}
    const secondRequest = new Promise<void>((resolve) => {
      markSecondRequest = resolve
    })
    const plan = (status: string) => ({steps: [{id: 's1', label: 'Do the thing', status}]})
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      const request = requests.length
      if (request === 1) return toolCallReply('chat-1', 'plan-1', 'plan', plan('pending'))
      if (request === 2) {
        markSecondRequest()
        await gate
        // The turn ends with its plan still open, so the run takes another pass.
        return textReply('chat-2', 'Working on it.')
      }
      if (request === 3) return toolCallReply('chat-3', 'plan-3', 'plan', plan('done'))
      return textReply(`chat-${request}`, `Answer ${request}`)
    }) as unknown as typeof fetch

    const first = h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Question one'}]})
    await secondRequest
    const second = h.send({
      _: 'MessageSession',
      sessionId: h.sessionId,
      content: [{type: 'text', text: 'Question two'}],
    })
    const userMessages = () =>
      eventRows(h.db, h.sessionId).filter((row) => row.type === 'message' && row.role === 'user').length
    while (userMessages() < 2) await Bun.sleep(1)
    release()
    await Promise.all([first, second])
    await h.service.awaitQueueIdle()

    // Two requests for the first pass, two for the pass its open plan caused, one for the message
    // that waited. The second pass does not read that message; its own run does, after it.
    expect(requests).toHaveLength(5)
    const mentions = requests.map(
      (request) => request.filter((message) => String(message.content).includes('Question two')).length,
    )
    expect(mentions).toEqual([0, 0, 0, 0, 1])
    const last = (requests[4] ?? []).map((message) => String(message.content))
    expect(last.findIndex((content) => content.includes('Question two'))).toBeGreaterThan(
      last.findIndex((content) => content === 'Answer 4'),
    )
    expect(last.some((content) => content.includes('<concurrent_user_messages>'))).toBe(false)
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
  })

  test('a run restarted after the answer of its second pass does not ask the model again', async () => {
    const h = await createSession()
    let providerRequests = 0
    const plan = (status: string) => ({steps: [{id: 's1', label: 'Do the thing', status}]})
    globalThis.fetch = mock(async () => {
      providerRequests += 1
      if (providerRequests === 1) return toolCallReply('chat-1', 'plan-1', 'plan', plan('pending'))
      if (providerRequests === 3) return toolCallReply('chat-3', 'plan-3', 'plan', plan('done'))
      return textReply(`chat-${providerRequests}`, `Answer ${providerRequests}`)
    }) as unknown as typeof fetch
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Only question'}]})
    h.service.stopRunQueue()
    expect(providerRequests).toBe(4)

    // The process died after the second pass answered, before the run was closed.
    h.db.run(
      `UPDATE runs SET status = 'running', lease_owner = 'dead-process', finished_at = NULL, output_cbor = NULL
         WHERE session_id = ?`,
      [h.sessionId],
    )
    const restarted = new apisvc.Service(h.db, h.dataDir, {})
    cleanups.push(() => restarted.stopRunQueue())
    await restarted.awaitQueueIdle()

    expect(providerRequests).toBe(4)
    const run = h.db.query<{status: string}, [string]>(`SELECT status FROM runs WHERE session_id = ?`).get(h.sessionId)
    expect(run?.status).toBe('succeeded')
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
  })

  test('a call a restart cut off under another run reads the same on every later turn', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    let reads = 0
    let markToolStarted = () => {}
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve
    })
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (href.includes('/api/Resource')) {
        reads += 1
        if (reads > 1) return notesDocumentResponse()
        markToolStarted()
        return new Promise<Response>(() => {})
      }
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      requests.push(providerMessages(init))
      return requests.length === 1
        ? toolCallReply('chat-1', 'call-read', 'read', {address: 'hm://z6Mkdoc/notes'})
        : textReply(`chat-${requests.length}`, `Answer ${requests.length}`)
    }) as unknown as typeof fetch
    void h
      .send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'What do the notes say?'}]})
      .catch(() => {})
    await toolStarted
    h.service.stopRunQueue()
    h.db = Database.deserialize(h.db.serialize())
    if (!sqlite.openWithDatabase(h.db).ok) throw new Error('unexpected schema mismatch')
    cleanups.push(() => sqlite.closeDatabase(h.db))
    // The run does not come back: it failed across the restart, and another run opens the store.
    h.db.run(`UPDATE runs SET status = 'failed', lease_owner = NULL, finished_at = ? WHERE session_id = ?`, [
      Date.now(),
      h.sessionId,
    ])
    const restarted = new apisvc.Service(h.db, h.dataDir, {})
    cleanups.push(() => restarted.stopRunQueue())
    const send = async (action: unknown) =>
      restarted.message(await apisvc.createSignedEnvelope(h.account, {action: action as never}))

    await send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Second question'}]})
    await restarted.awaitQueueIdle()
    const resetsAfterSecond = (await durableEntries(h)).filter((entry) => durable.ResetEntry.is(entry)).length
    await send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Third question'}]})
    await restarted.awaitQueueIdle()

    // The runtime's own answer for the call is in the log, and it is what the model reads from the
    // first turn after the restart on. That turn rebuilds the context; the one after only appends.
    const results = requests
      .slice(1)
      .map((request) => String(request.find((message) => message.role === 'tool')?.content))
    expect(results).toHaveLength(2)
    for (const result of results) expect(result).toStartWith('Interrupted by a service restart')
    const resets = (await durableEntries(h)).filter((entry) => durable.ResetEntry.is(entry)).length
    expect(resets).toBe(resetsAfterSecond)
  })

  test('a parked run whose children were answered for by another turn has nothing left to ask', async () => {
    const h = await createSession()
    const parentRequests: ChatMessage[][] = []
    let releaseChild = () => {}
    const childGate = new Promise<void>((resolve) => {
      releaseChild = resolve
    })
    const childResultLogged = () =>
      h.db
        .query<{event_cbor: Uint8Array}, [string]>(`SELECT event_cbor FROM session_events WHERE session_id = ?`)
        .all(h.sessionId)
        .some((row) => {
          const event = cbor.decode<{type: string; toolCallId?: string}>(row.event_cbor)
          return event.type === 'tool_result' && event.toolCallId === 'spawn-1'
        })
    const plan = (first: string, second: string) => ({
      steps: [
        {id: 's1', label: 'Delegated part', status: first},
        {id: 's2', label: 'Write up', status: second},
      ],
    })
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const messages = providerMessages(init)
      if (String(messages[0]?.content).includes('You are the worker.')) {
        await childGate
        return textReply('child', 'Worker finished.')
      }
      parentRequests.push(messages)
      const request = parentRequests.length
      if (request === 1) return toolCallReply('chat-1', 'plan-1', 'plan', plan('running', 'pending'))
      if (request === 2) {
        return toolCallReply('chat-2', 'spawn-1', 'delegate', {
          title: 'Worker',
          prompt: 'You are the worker.',
          brief: 'Do the task',
        })
      }
      if (request === 3) {
        // The person's question is answered while the child finishes, with the plan still open:
        // this turn takes a second pass, and that pass reads the child's result.
        releaseChild()
        while (!childResultLogged()) await Bun.sleep(1)
        return textReply('chat-3', 'Still working.')
      }
      if (request === 4) return toolCallReply('chat-4', 'plan-4', 'plan', plan('done', 'done'))
      return textReply(`chat-${request}`, `Reply ${request}`)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Delegate the task'}]})
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'How is it going?'}]})
    await h.service.awaitQueueIdle()

    // The parked run wakes to find its child's result already read and answered for. It neither
    // rebuilds the conversation nor asks the model a sixth time.
    expect(parentRequests).toHaveLength(5)
    expect(parentRequests.flat().some((message) => String(message.content).includes('<background_work_update>'))).toBe(
      false,
    )
    const entries = await durableEntries(h)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
    const statuses = h.db.query<{status: string}, []>(`SELECT status FROM runs`).all()
    expect(statuses.map((row) => row.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
  })

  test('a store rebuilt while a run is parked still holds the request that run is working on', async () => {
    const h = await createSession()
    const parentRequests: ChatMessage[][] = []
    let releaseChild = () => {}
    const childGate = new Promise<void>((resolve) => {
      releaseChild = resolve
    })
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const messages = providerMessages(init)
      if (String(messages[0]?.content).includes('You are the worker.')) {
        await childGate
        return textReply('child', 'Worker finished.')
      }
      parentRequests.push(messages)
      if (parentRequests.length === 1) {
        return toolCallReply('chat-1', 'spawn-1', 'delegate', {
          title: 'Worker',
          prompt: 'You are the worker.',
          brief: 'Do the task',
        })
      }
      return textReply(`chat-${parentRequests.length}`, `Reply ${parentRequests.length}`)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Delegate the task'}]})
    dropStore(h)
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'How is it going?'}]})
    releaseChild()
    await h.service.awaitQueueIdle()

    // The parked run is not waiting its turn; its message is part of what the model already read.
    const rebuilt = (parentRequests[1] ?? []).map((message) => String(message.content))
    expect(rebuilt.findIndex((content) => content.includes('Delegate the task'))).toBe(1)
    expect(rebuilt.findIndex((content) => content.includes('How is it going?'))).toBeGreaterThan(1)
  })

  test('a run restarted after its answer was committed does not ask the model again', async () => {
    const h = await createSession()
    let providerRequests = 0
    globalThis.fetch = mock(async () => {
      providerRequests += 1
      return textReply(`chat-${providerRequests}`, `Answer ${providerRequests}`)
    }) as unknown as typeof fetch
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Only question'}]})
    h.service.stopRunQueue()
    expect(providerRequests).toBe(1)

    // The process died after the answer reached the store and the log, before the run was closed.
    h.db.run(
      `UPDATE runs SET status = 'running', lease_owner = 'dead-process', finished_at = NULL, output_cbor = NULL
         WHERE session_id = ?`,
      [h.sessionId],
    )
    const restarted = new apisvc.Service(h.db, h.dataDir, {})
    cleanups.push(() => restarted.stopRunQueue())
    await restarted.awaitQueueIdle()

    expect(providerRequests).toBe(1)
    const run = h.db
      .query<{status: string; output_cbor: Uint8Array | null}, [string]>(
        `SELECT status, output_cbor FROM runs WHERE session_id = ?`,
      )
      .get(h.sessionId)
    expect(run?.status).toBe('succeeded')
    const messages = eventRows(h.db, h.sessionId).filter((row) => row.type === 'message')
    expect(messages.map((row) => row.role)).toEqual(['user', 'assistant'])
    const answerEventId = h.db
      .query<{id: string}, [string]>(
        `SELECT id FROM session_events WHERE session_id = ? AND pi_entry_id IS NOT NULL ORDER BY seq DESC LIMIT 1`,
      )
      .get(h.sessionId)?.id
    expect(cbor.decode<{assistantEventId?: string}>(run?.output_cbor ?? new Uint8Array()).assistantEventId).toBe(
      answerEventId ?? '',
    )
  })

  test('an input that was imported but never submitted still reaches the model, first', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply(`chat-${requests.length}`, `Answer ${requests.length}`)
    }) as unknown as typeof fetch
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'First question'}]})

    // A turn that died between recording its input and submitting it leaves this behind.
    const harness = await durableSession.openSessionHarness({
      db: h.db,
      sessionId: h.sessionId,
      models: piAi.createModels(),
      registry: durable.createRegistry(),
      onReport: () => {},
    })
    const root = await harness.root(durableSession.CONTEXT)
    await root.commit(async (tx) => {
      ;(await tx.doc(durableSession.SyncDoc, root.id)).input = {requestId: 'run:lost:1', content: 'Orphaned question'}
    }, durableSession.CONTEXT)
    await harness.close(durableSession.CONTEXT)

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Next question'}]})
    const users = (requests[1] ?? [])
      .filter((message) => message.role === 'user')
      .map((message) => String(message.content))
    const orphanAt = users.findIndex((content) => content === 'Orphaned question')
    expect(orphanAt).toBeGreaterThan(-1)
    expect(users.findIndex((content) => content.includes('Next question'))).toBeGreaterThan(orphanAt)
  })

  test('deleting a session deletes its durable store', async () => {
    const h = await createSession()
    globalThis.fetch = mock(async () => textReply('chat-1', 'Hello')) as unknown as typeof fetch
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Hi'}]})
    expect(storeRows(h).length).toBeGreaterThan(0)
    await h.send({_: 'DeleteSession', sessionId: h.sessionId})
    expect(storeRows(h)).toEqual([])
  })
})

/** The one file named `name` under a test's data directory, where the agent's memory lives. */
function memoryFile(h: TestSession, name: string): string | undefined {
  const walk = (dir: string): string | undefined => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = walk(full)
        if (found) return found
      } else if (entry.name === name) return full
    }
    return undefined
  }
  return walk(h.dataDir)
}

/** The session as a client reads it, from a service. */
async function sessionEvents(
  service: apisvc.Service,
  h: TestSession,
): Promise<Array<{type: string; content?: string; error?: string; message?: string; output?: unknown}>> {
  const session = await service.message(
    await apisvc.createSignedEnvelope(h.account, {action: {_: 'GetSession', sessionId: h.sessionId}}),
  )
  if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
  return session.events.map(
    (event) => event.event as {type: string; content?: string; error?: string; message?: string; output?: unknown},
  )
}

describe('effect outbox in a turn', () => {
  test('a write cut off mid-effect by a process death is answered as interrupted, naming the effect', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    let downloads = 0
    let markDownloadStarted = () => {}
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve
    })
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (href.includes('files.example')) {
        // The process dies while the download is in flight: it never returns.
        downloads += 1
        markDownloadStarted()
        return new Promise<Response>(() => {})
      }
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      requests.push(providerMessages(init))
      return requests.length === 1
        ? toolCallReply('chat-1', 'call-write', 'write', {
            address: '~/memory/notes.txt',
            options: {fromUrl: 'https://files.example/notes.txt'},
          })
        : textReply('chat-2', 'The download was interrupted; I did not retry it.')
    }) as unknown as typeof fetch

    void h
      .send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Save the notes'}]})
      .catch(() => {})
    await downloadStarted
    h.service.stopRunQueue()
    // The intent was committed before the effect began, under the process that died.
    const before = effectOutbox.get(h.db, effectOutbox.effectId(h.sessionId, 'call-write'))
    expect(before?.status).toBe('running')
    expect(before?.kind).toBe('memory-write')

    h.db = Database.deserialize(h.db.serialize())
    if (!sqlite.openWithDatabase(h.db).ok) throw new Error('unexpected schema mismatch')
    cleanups.push(() => sqlite.closeDatabase(h.db))
    const restarted = new apisvc.Service(h.db, h.dataDir, {})
    cleanups.push(() => restarted.stopRunQueue())
    await restarted.awaitQueueIdle()

    // The same run adopted the turn and the harness reran the call; the outbox answered it from
    // the row the dead process left, so the download did not start again and the model was told
    // exactly which effect was cut off.
    expect(downloads).toBe(1)
    expect(requests).toHaveLength(2)
    const toolResult = (requests[1] ?? []).find((message) => message.role === 'tool')
    expect(toolResult?.tool_call_id).toBe('call-write')
    expect(String(toolResult?.content)).toContain('Interrupted while writing a memory file')
    const row = effectOutbox.get(h.db, effectOutbox.effectId(h.sessionId, 'call-write'))
    expect(row?.status).toBe('interrupted')

    const events = await sessionEvents(restarted, h)
    expect(events.map((event) => event.type)).toEqual(['message', 'message', 'tool_call', 'tool_result', 'message'])
    expect(events[3]?.error).toContain('writing a memory file')
    expect(events[4]?.content).toBe('The download was interrupted; I did not retry it.')
    expect(memoryFile(h, 'notes.txt')).toBeUndefined()
    const run = h.db.query<{status: string}, [string]>(`SELECT status FROM runs WHERE session_id = ?`).get(h.sessionId)
    expect(run?.status).toBe('succeeded')
  })

  test('a call that finished before its run died is answered from its receipt, and its effect is not repeated', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      requests.push(providerMessages(init))
      return requests.length === 1
        ? toolCallReply('chat-1', 'call-write', 'write', {address: '~/memory/notes.md', content: 'hello'})
        : textReply('chat-2', 'Saved.')
    }) as unknown as typeof fetch

    // The store's next commit is refused as soon as the receipt exists: the tool ran, its receipt
    // is written, and the process dies before the harness can commit the result.
    h.db.run(
      `CREATE TRIGGER die_after_receipt BEFORE INSERT ON session_durable_files
         WHEN EXISTS (SELECT 1 FROM effect_outbox WHERE status = 'succeeded')
         BEGIN SELECT RAISE(ABORT, 'simulated process death'); END`,
    )
    await expect(
      h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Save hello'}]}),
    ).rejects.toThrow()
    h.db.run(`DROP TRIGGER die_after_receipt`)
    expect(requests).toHaveLength(1)
    const notes = memoryFile(h, 'notes.md')
    if (!notes) throw new Error('the write did not happen')
    expect(fs.readFileSync(notes, 'utf8')).toBe('hello')
    const row = effectOutbox.get(h.db, effectOutbox.effectId(h.sessionId, 'call-write'))
    expect(row?.status).toBe('succeeded')
    expect(row?.kind).toBe('memory-write')
    // Anything written after the receipt stays: a repeated write would put 'hello' back.
    fs.writeFileSync(notes, 'edited after the crash')

    const retried = await h.send({_: 'RetrySession', sessionId: h.sessionId})
    expect(retried._).toBe('RetrySessionResponse')
    // The retry is another run: the dead run's call is answered in the log from its receipt, so
    // the model reads what the write did instead of being told to go and check.
    expect(requests).toHaveLength(2)
    const toolResult = (requests[1] ?? []).find((message) => message.role === 'tool')
    expect(toolResult?.tool_call_id).toBe('call-write')
    expect(String(toolResult?.content)).toContain('notes.md')
    expect(String(toolResult?.content)).not.toContain('Interrupted')
    expect(fs.readFileSync(notes, 'utf8')).toBe('edited after the crash')
    const events = await sessionEvents(h.service, h)
    const result = events.find((event) => event.type === 'tool_result')
    expect(result?.error).toBeUndefined()
    expect(JSON.stringify(result?.output)).toContain('notes.md')
    expect(events.at(-1)?.content).toBe('Saved.')
  })

  test('a turn whose log write fails ends in an error, and the next open writes what was missed', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      requests.push(providerMessages(init))
      if (requests.length === 1) {
        // The disk fills while the model answers: every projection of a durable entry into the
        // log is refused from here on. Seed's own rows (the run's error) still land.
        h.db.run(
          `CREATE TRIGGER disk_full BEFORE INSERT ON session_events
             WHEN NEW.pi_entry_id IS NOT NULL
             BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END`,
        )
      }
      return textReply('chat-1', 'Here is the answer.')
    }) as unknown as typeof fetch

    await expect(
      h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Question'}]}),
    ).rejects.toThrow(/could not be recorded/)
    h.db.run(`DROP TRIGGER disk_full`)
    expect(requests).toHaveLength(1)
    // The answer is committed in the store and missing from the log, and the run says so.
    const before = await sessionEvents(h.service, h)
    expect(before.filter((event) => event.type === 'message')).toHaveLength(1)
    expect(before.find((event) => event.type === 'error')?.message ?? '').toContain('disk is full')
    const failed = h.db
      .query<{status: string}, [string]>(`SELECT status FROM runs WHERE session_id = ? ORDER BY created_at DESC`)
      .get(h.sessionId)
    expect(failed?.status).toBe('failed')

    // The next run opens the store, writes the entries the log is missing, finds the question
    // answered, and does not ask the model again.
    const retried = await h.send({_: 'RetrySession', sessionId: h.sessionId})
    expect(retried._).toBe('RetrySessionResponse')
    expect(requests).toHaveLength(1)
    const after = await sessionEvents(h.service, h)
    const answers = after.filter((event) => event.type === 'message' && event.content === 'Here is the answer.')
    expect(answers).toHaveLength(1)
  })

  test('a retry while dispatch is paused waits in the queue instead of being cancelled', async () => {
    const h = await createSession()
    let healthy = false
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = url instanceof Request ? url.url : String(url)
      if (!href.includes('/chat/completions')) return Response.json(serialize({}))
      requests.push(providerMessages(init))
      return healthy ? textReply('chat-ok', 'Back on a roomy disk.') : new Response('boom', {status: 500})
    }) as unknown as typeof fetch
    await expect(
      h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Question'}]}),
    ).rejects.toThrow()
    h.service.stopRunQueue()

    // The same database, served by a process whose disk floor no disk can meet.
    const paused = new apisvc.Service(h.db, h.dataDir, {
      storage: {path: h.dataDir, minFreeBytes: Number.MAX_SAFE_INTEGER},
    })
    cleanups.push(() => paused.stopRunQueue())
    const send = async (action: unknown) =>
      paused.message(await apisvc.createSignedEnvelope(h.account, {action: action as never}))
    healthy = true
    const requestsBefore = requests.length
    const retried = await send({_: 'RetrySession', sessionId: h.sessionId})
    expect(retried._).toBe('RetrySessionResponse')
    if (retried._ !== 'RetrySessionResponse') throw new Error('unexpected response')
    expect(retried.assistantEventId).toBe('')
    const latest = h.db
      .query<{status: string}, [string]>(`SELECT status FROM runs WHERE session_id = ? ORDER BY created_at DESC`)
      .get(h.sessionId)
    // Held, not cancelled: it runs once dispatch resumes, and the model was not asked meanwhile.
    expect(latest?.status).toBe('queued')
    expect(requests).toHaveLength(requestsBefore)
  })
})

describe('StreamedTextTracker', () => {
  const partial = (...texts: string[]): piAi.AssistantMessage =>
    ({
      role: 'assistant',
      content: texts.map((text) => ({type: 'text', text})),
    }) as piAi.AssistantMessage
  const usage = {} as piAi.Usage

  test('reports only the text each event adds, across blocks', () => {
    const tracker = new durableSession.StreamedTextTracker()
    expect(tracker.apply({type: 'message_start', message: partial('Hel')})).toBe('Hel')
    expect(
      tracker.apply({type: 'message_update', usage, changes: [{type: 'text_delta', contentIndex: 0, delta: 'lo'}]}),
    ).toBe('lo')
    expect(
      tracker.apply({
        type: 'message_update',
        usage,
        changes: [{type: 'text_start', contentIndex: 1, block: {type: 'text', text: ' wor'}}],
      }),
    ).toBe(' wor')
    expect(
      tracker.apply({
        type: 'message_update',
        usage,
        changes: [{type: 'block', contentIndex: 1, block: {type: 'text', text: ' world'}}],
      }),
    ).toBe('ld')
    expect(tracker.text).toBe('Hello world')
  })

  test('ignores other messages and text that was replaced rather than extended', () => {
    const tracker = new durableSession.StreamedTextTracker()
    expect(tracker.apply({type: 'message_start', message: {role: 'user', content: 'hi', timestamp: 0}})).toBe('')
    tracker.apply({type: 'message_start', message: partial('First attempt')})
    // A retried attempt replaces the partial; that is not an append and waits for the final text.
    expect(
      tracker.apply({type: 'message_update', usage, changes: [{type: 'message', message: partial('Second')}]}),
    ).toBe('')
    tracker.reset()
    expect(tracker.apply({type: 'message_start', message: partial('Fresh')})).toBe('Fresh')
  })
})

describe('harnessResultText', () => {
  test('strips the frame the harness shows the model around its own results', () => {
    expect(durableSession.harnessResultText('<harness>\n[interrupted] Tool read was interrupted\n</harness>')).toBe(
      'Tool read was interrupted',
    )
    expect(durableSession.harnessResultText('plain tool error')).toBe('plain tool error')
  })
})

describe('sessionFileSystem', () => {
  const open = (filename = ':memory:') => {
    const db = new Database(filename, {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
    cleanups.push(() => sqlite.closeDatabase(db))
    const now = Date.now()
    db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES ('acct', ?, ?)`, [now, now])
    db.run(
      `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
         VALUES ('agent', 'acct', X'A0', '/tmp/agent', 'idle', ?, ?)`,
      [now, now],
    )
    for (const id of ['s1', 's2']) {
      db.run(
        `INSERT INTO sessions (id, account_id, agent_id, status, created_at, updated_at)
           VALUES (?, 'acct', 'agent', 'idle', ?, ?)`,
        [id, now, now],
      )
    }
    return db
  }
  const text = async (files: ReturnType<typeof durableSession.sessionFileSystem>, file: string) => {
    const read = await files.readBinaryFile(file, durableSession.CONTEXT)
    return read.ok ? new TextDecoder().decode(read.value) : read.error.code
  }

  test('concurrent commits remain monotonic and reopen after draining on close', async () => {
    const db = open()
    const store = await durableSession.openSessionStorage(db, 's1')
    const commits = Array.from({length: 20}, () => store.commit([], durableSession.CONTEXT))
    const closed = store.close(durableSession.CONTEXT)
    expect((await Promise.all(commits)).map(Number)).toEqual(Array.from({length: 20}, (_, index) => index + 1))
    await closed
    await expect(store.commit([], durableSession.CONTEXT)).rejects.toThrow('closed')
    const reopened = await durableSession.openSessionStorage(db, 's1')
    expect(Number(await reopened.commit([], durableSession.CONTEXT))).toBe(21)
    await reopened.close(durableSession.CONTEXT)
    const journal = await text(durableSession.sessionFileSystem(db, 's1'), 'main.jsonl')
    expect(
      journal
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).seq),
    ).toEqual(Array.from({length: 21}, (_, index) => index + 1))
  })

  test('rejects a second writer and releases ownership only after close drains', async () => {
    const db = open()
    const first = await durableSession.openSessionStorage(db, 's1')
    await expect(durableSession.openSessionStorage(db, 's1')).rejects.toThrow('already open')
    const other = await durableSession.openSessionStorage(db, 's2')
    const pending = first.commit([], durableSession.CONTEXT)
    const closing = first.close(durableSession.CONTEXT)
    await expect(durableSession.openSessionStorage(db, 's1')).rejects.toThrow('already open')
    await pending
    await closing
    const reopened = await durableSession.openSessionStorage(db, 's1')
    expect(Number(await reopened.commit([], durableSession.CONTEXT))).toBe(2)
    await reopened.close(durableSession.CONTEXT)
    await other.close(durableSession.CONTEXT)
  })

  test('separate connections to the same database cannot open competing writers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-writer-test-'))
    cleanups.push(() => fs.rmSync(dir, {recursive: true, force: true}))
    const file = path.join(dir, 'agents.sqlite')
    const db = open(file)
    const other = new Database(file)
    cleanups.push(() => other.close())
    const writer = await durableSession.openSessionStorage(db, 's1')
    await expect(durableSession.openSessionStorage(other, 's1')).rejects.toThrow('already open')
    await writer.close(durableSession.CONTEXT)
    const next = await durableSession.openSessionStorage(other, 's1')
    await next.close(durableSession.CONTEXT)
  })

  test('does not discard malformed journals or recover without a canonical log', async () => {
    const db = open()
    const files = durableSession.sessionFileSystem(db, 's1')
    for (const data of [
      'invalid json\n',
      [1, 1].map((seq) => JSON.stringify({format: 1, type: 'commit', seq, writes: []})).join('\n') + '\n',
    ]) {
      await files.writeFile('main.jsonl', data, durableSession.CONTEXT)
      await expect(durableSession.openSessionStorage(db, 's1')).rejects.toThrow()
      expect(await text(files, 'main.jsonl')).toBe(data)
    }
  })

  test('files are appended to, replaced, truncated, renamed and removed, each within its session', async () => {
    const db = open()
    const one = durableSession.sessionFileSystem(db, 's1')
    const two = durableSession.sessionFileSystem(db, 's2')
    const context = durableSession.CONTEXT

    expect(await text(one, 'main.jsonl')).toBe('not_found')
    await one.appendFile('main.jsonl', 'a\n', context)
    await one.appendFile('main.jsonl', new TextEncoder().encode('b\n'), context)
    await two.appendFile('main.jsonl', 'other\n', context)
    expect(await text(one, 'main.jsonl')).toBe('a\nb\n')
    expect(await text(two, 'main.jsonl')).toBe('other\n')

    await one.truncateFile('main.jsonl', 2, context)
    expect(await text(one, 'main.jsonl')).toBe('a\n')
    await one.writeFile('doc-2.jsonl.reclaim', 'fresh\n', context)
    await one.appendFile('doc-2.jsonl', 'stale\n', context)
    await one.renameFile('doc-2.jsonl.reclaim', 'doc-2.jsonl', context)
    expect(await text(one, 'doc-2.jsonl')).toBe('fresh\n')
    expect(await text(one, 'doc-2.jsonl.reclaim')).toBe('not_found')

    const listed = await one.listDir('', context)
    if (!listed.ok) throw listed.error
    expect(listed.value.map((info) => [info.name, info.kind, info.size]).sort()).toEqual([
      ['doc-2.jsonl', 'file', 6],
      ['main.jsonl', 'file', 2],
    ])
    await one.remove('doc-2.jsonl', {force: true}, context)
    expect(await text(one, 'doc-2.jsonl')).toBe('not_found')
    expect((await one.exists('main.jsonl', context)).ok).toBe(false)
    expect(await text(two, 'main.jsonl')).toBe('other\n')
  })

  test('a file of many appends is stored as one row once it is read', async () => {
    const db = open()
    const files = durableSession.sessionFileSystem(db, 's1')
    const lines = Array.from({length: 300}, (_, index) => `line ${index}\n`)
    for (const line of lines) await files.appendFile('main.jsonl', line, durableSession.CONTEXT)
    const rows = () =>
      db.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM session_durable_files WHERE session_id = 's1'`).get()?.n
    expect(rows()).toBe(300)
    expect(await text(files, 'main.jsonl')).toBe(lines.join(''))
    expect(rows()).toBe(1)
    await files.appendFile('main.jsonl', 'after\n', durableSession.CONTEXT)
    expect(await text(files, 'main.jsonl')).toBe(`${lines.join('')}after\n`)
  })

  test('deleting the session deletes its files', async () => {
    const db = open()
    await durableSession.sessionFileSystem(db, 's1').appendFile('main.jsonl', 'a\n', durableSession.CONTEXT)
    db.run(`DELETE FROM sessions WHERE id = 's1'`)
    expect(db.query(`SELECT 1 FROM session_durable_files`).all()).toEqual([])
  })
})
