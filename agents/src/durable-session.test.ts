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
import * as sqlite from '@/sqlite'
import * as cbor from '@/cbor'

/**
 * The durable session runtime end to end: every session keeps one Pi Durable conversation that its
 * turns append to, the Seed log and that conversation stay in step from both sides, a turn cut off
 * by a process death continues from its last checkpoint, and a store that is lost is rebuilt from
 * the log. Driven through the real run queue with a canned provider.
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
  /** Directory of the session's durable store. */
  durableDir: string
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
  const stateDir = db
    .query<{state_dir: string}, [string]>(`SELECT state_dir FROM agents WHERE id = ?`)
    .get(agent.agentId)?.state_dir
  if (!stateDir) throw new Error('agent has no state dir')
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
    durableDir: durableSession.sessionDurableDir(stateDir, session.sessionId),
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

/** The entries of a session's durable conversation, read from its store on disk. */
async function durableEntries(dir: string): Promise<durable.EntryRecord[]> {
  const harness = await durableSession.openSessionHarness({
    dir,
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
  test('a session appends its turns to one durable conversation and keeps the prompt prefix byte-stable', async () => {
    const h = await createSession()
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply(`chat-${requests.length}`, `Answer ${requests.length}`)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'First question'}]})
    // The clock moves between turns; nothing the model already read may change because of it.
    await Bun.sleep(5)
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
    // Per-turn state rides behind each turn's own input and is never stored: one clock per request.
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
    const entries = await durableEntries(h.durableDir)
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

    // "Restart": a fresh service over the same database and data directory sweeps the run back
    // into the queue and adopts the turn the dead process left in the durable store.
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
    const h = await createSession()
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply(`chat-${requests.length}`, `Answer ${requests.length}`)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'First question'}]})
    expect(fs.existsSync(h.durableDir)).toBe(true)
    fs.rmSync(h.durableDir, {recursive: true, force: true})
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Second question'}]})

    // The log is the record: the new store's context was filled from it, so the model still reads
    // the whole conversation.
    const second = (requests[1] ?? []).slice(1).map((message) => String(message.content))
    expect(second[0]).toContain('First question')
    expect(second[1]).toBe('Answer 1')
    expect(second[2]).toContain('Second question')
    // Entry ids of the lost store mean nothing to the new one: only this turn's answer is marked.
    const rows = eventRows(h.db, h.sessionId).filter((row) => row.type === 'message')
    expect(rows.map((row) => row.entry === null)).toEqual([true, true, true, false])
    const entries = await durableEntries(h.durableDir)
    expect(entries.filter((entry) => durable.AssistantEntry.is(entry))).toHaveLength(1)
    expect(entries.filter((entry) => durableSession.ReplayEntry.is(entry)).length).toBeGreaterThanOrEqual(2)
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

    // The next turn appends to the same conversation. The cut-off answer is in the log for people;
    // the model is not shown an answer it never finished.
    const requests: ChatMessage[][] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(providerMessages(init))
      return textReply('chat-2', 'Short answer.')
    }) as unknown as typeof fetch
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Shorter please'}]})
    const next = (requests[0] ?? []).slice(1).map((message) => String(message.content))
    expect(next.some((content) => content.includes('Explain'))).toBe(true)
    expect(next.some((content) => content.includes('Shorter please'))).toBe(true)
    const entries = await durableEntries(h.durableDir)
    expect(entries.filter((entry) => durable.ResetEntry.is(entry))).toHaveLength(1)
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
    expect(fs.readFileSync(path.join(h.durableDir, 'main.jsonl'), 'utf8')).not.toContain(imageBase64)
  })

  test('deleting a session deletes its durable store', async () => {
    const h = await createSession()
    globalThis.fetch = mock(async () => textReply('chat-1', 'Hello')) as unknown as typeof fetch
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Hi'}]})
    expect(fs.existsSync(h.durableDir)).toBe(true)
    await h.send({_: 'DeleteSession', sessionId: h.sessionId})
    expect(fs.existsSync(h.durableDir)).toBe(false)
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
