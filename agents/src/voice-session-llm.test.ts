import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {initializeLogger, llm} from '@livekit/agents'
import {SeedSessionLLM, VoiceServerClient, lastUserText} from './voice-session-llm'

type TurnHandler = (body: {room: string; text: string}) => Response

let server: ReturnType<typeof Bun.serve>
let onTurn: TurnHandler = () => new Response('unset', {status: 500})
const requests: {route: string; auth: string | null; body: unknown}[] = []

function ndjson(lines: unknown[], delayMs = 0): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      for (const line of lines) {
        controller.enqueue(enc.encode(JSON.stringify(line) + '\n'))
        if (delayMs) await Bun.sleep(delayMs)
      }
      controller.close()
    },
  })
  return new Response(stream, {headers: {'Content-Type': 'application/x-ndjson'}})
}

beforeAll(() => {
  // LLMStream pulls the framework logger; the CLI normally initializes it at worker start.
  initializeLogger({pretty: false, level: 'silent'})
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const route = new URL(req.url).pathname.replace('/agents/api/voice/', '')
      const body = (await req.json()) as {room: string; text: string}
      requests.push({route, auth: req.headers.get('authorization'), body})
      if (req.headers.get('authorization') !== 'Bearer secret-token') return new Response('nope', {status: 401})
      if (route === 'turn') return onTurn(body)
      if (route === 'room-config') return Response.json({sessionId: 's1', deepgramApiKey: 'd', cartesiaApiKey: 'c'})
      if (route === 'leave') return Response.json({ok: true})
      return new Response('not found', {status: 404})
    },
  })
})

afterAll(() => {
  server.stop(true)
})

function client(token = 'secret-token'): VoiceServerClient {
  return new VoiceServerClient({serverUrl: `http://127.0.0.1:${server.port}/`, token})
}

function chatCtxWith(...items: {role: 'user' | 'assistant' | 'system'; text: string}[]): llm.ChatContext {
  const ctx = llm.ChatContext.empty()
  for (const item of items) ctx.addMessage({role: item.role, content: item.text})
  return ctx
}

describe('VoiceServerClient', () => {
  test('sends the bearer token and parses room-config', async () => {
    requests.length = 0
    const config = await client().roomConfig('room-a')
    expect(config.sessionId).toBe('s1')
    expect(config.deepgramModel).toBe('nova-3')
    expect(config.turnDetector).toBe(false)
    expect(requests[0]).toMatchObject({route: 'room-config', auth: 'Bearer secret-token', body: {room: 'room-a'}})
  })

  test('rejects with the HTTP status when the server refuses', async () => {
    await expect(client('wrong').roomConfig('room-a')).rejects.toThrow('HTTP 401')
  })

  test('leave posts the room', async () => {
    requests.length = 0
    await client().leave('room-b')
    expect(requests[0]).toMatchObject({route: 'leave', body: {room: 'room-b'}})
  })
})

describe('lastUserText', () => {
  test('returns the most recent non-empty user message', () => {
    const ctx = chatCtxWith(
      {role: 'system', text: 'sys'},
      {role: 'user', text: 'first'},
      {role: 'assistant', text: 'a'},
      {role: 'user', text: '  second  '},
    )
    expect(lastUserText(ctx)).toBe('second')
  })

  test('is undefined without a user message', () => {
    expect(lastUserText(chatCtxWith({role: 'assistant', text: 'a'}))).toBeUndefined()
  })
})

describe('SeedSessionLLM', () => {
  test('posts the last user message and streams the reply deltas as speech text', async () => {
    requests.length = 0
    onTurn = () =>
      ndjson(
        [{delta: 'Hello **there**, '}, {delta: 'see [the guide](hm://z6Mk/guide).'}, {done: true, text: 'final'}],
        5,
      )
    const model = new SeedSessionLLM({client: client(), room: 'room-c'})
    const stream = model.chat({
      chatCtx: chatCtxWith(
        {role: 'user', text: 'old'},
        {role: 'assistant', text: 'x'},
        {role: 'user', text: 'What now?'},
      ),
    })
    const collected = await stream.collect()
    expect(collected.text).toBe('Hello there, see the guide.')
    expect(collected.toolCalls).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({route: 'turn', body: {room: 'room-c', text: 'What now?'}})
  })

  test('yields nothing for a tools-only turn with empty text', async () => {
    onTurn = () => ndjson([{done: true, text: ''}])
    const stream = new SeedSessionLLM({client: client(), room: 'room-c'}).chat({
      chatCtx: chatCtxWith({role: 'user', text: 'do it'}),
    })
    expect((await stream.collect()).text).toBe('')
  })

  test('reports an error line through the error event, keeps the partial text, never retries', async () => {
    requests.length = 0
    const errors: {recoverable: boolean; error: Error}[] = []
    onTurn = () => ndjson([{delta: 'partial '}, {error: 'session stopped'}])
    const model = new SeedSessionLLM({client: client(), room: 'room-c'})
    model.on('error', (err) => errors.push(err))
    const stream = model.chat({chatCtx: chatCtxWith({role: 'user', text: 'hi'})})
    // The framework swallows run() failures and surfaces them as an LLM error event; the
    // pipeline then counts it against the session's unrecoverable-error budget.
    expect((await stream.collect()).text.trim()).toBe('partial')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.recoverable).toBe(false)
    expect(errors[0]?.error.message).toContain('session stopped')
    expect(requests).toHaveLength(1)
  })

  test('reports a rejected turn (unknown room) as a non-recoverable error', async () => {
    const errors: {recoverable: boolean; error: Error}[] = []
    onTurn = () => new Response('unknown room', {status: 403})
    const model = new SeedSessionLLM({client: client(), room: 'room-c'})
    model.on('error', (err) => errors.push(err))
    const stream = model.chat({chatCtx: chatCtxWith({role: 'user', text: 'hi'})})
    expect((await stream.collect()).text).toBe('')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.error.message).toContain('HTTP 403')
  })

  test('does not call the server when there is no user message', async () => {
    requests.length = 0
    const stream = new SeedSessionLLM({client: client(), room: 'room-c'}).chat({
      chatCtx: chatCtxWith({role: 'assistant', text: 'only me'}),
    })
    expect((await stream.collect()).text).toBe('')
    expect(requests).toHaveLength(0)
  })

  test('stops reading when closed mid-stream', async () => {
    onTurn = () => ndjson([{delta: 'one '}, {delta: 'two '}, {delta: 'three '}, {done: true, text: ''}], 40)
    const stream = new SeedSessionLLM({client: client(), room: 'room-c'}).chat({
      chatCtx: chatCtxWith({role: 'user', text: 'hi'}),
    })
    const first = await stream.next()
    expect(first.done).toBe(false)
    stream.close()
    const rest = await stream.next()
    expect(rest.done).toBe(true)
  })
})
