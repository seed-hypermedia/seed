import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import type * as api from '@/api'
import * as apisvc from '@/api-service'
import * as config from '@/config'
import {createAPIRoutes} from '@/main'
import * as sqlite from '@/sqlite'
import * as voicesvc from '@/voice'
import * as blobs from '@shm/shared/blobs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const TOKEN = 'test-internal-token'

describe('voice service', () => {
  test('mints a room-scoped participant token and dispatches the worker', async () => {
    const dispatch = new FakeDispatch()
    const now = 1_700_000_000_000
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch, now: () => now})
    const created = await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    expect(created).toMatchObject({
      _: 'CreateVoiceSessionResponse',
      sessionId: 'sess-1',
      url: 'ws://localhost:7880',
      room: 'seed-voice-sess-1',
      identity: 'user-speaker',
      expiresAt: now + voicesvc.VOICE_TOKEN_TTL_MS,
    })
    const payload = decodeJwt(created.token)
    expect(payload.sub).toBe('user-speaker')
    expect(payload.iss).toBe('devkey')
    expect(payload.video).toMatchObject({
      room: 'seed-voice-sess-1',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    })
    // The library stamps exp from the wall clock; it must be about an hour out.
    expect(payload.exp * 1000).toBeGreaterThan(Date.now() + voicesvc.VOICE_TOKEN_TTL_MS - 60_000)
    expect(payload.exp * 1000).toBeLessThanOrEqual(Date.now() + voicesvc.VOICE_TOKEN_TTL_MS + 60_000)

    expect(dispatch.calls).toEqual([
      {room: 'seed-voice-sess-1', agentName: 'seed-voice', metadata: JSON.stringify({sessionId: 'sess-1'})},
    ])
    expect(voice.room('seed-voice-sess-1')).toMatchObject({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
      createdAt: now,
    })
  })

  test('a failing dispatch does not fail the token; re-issuing replaces the record; records expire', async () => {
    const dispatch = new FakeDispatch()
    dispatch.fail = new Error('already dispatched')
    let now = 1_700_000_000_000
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch, now: () => now})
    const first = await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'one', cartesiaApiKey: 'ca'},
    })
    expect(first.room).toBe('seed-voice-sess-1')
    await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-2'},
      keys: {deepgramApiKey: 'two', cartesiaApiKey: 'ca'},
    })
    expect(voice.room('seed-voice-sess-1')).toMatchObject({
      keys: {deepgramApiKey: 'two'},
      userOrigin: {signerId: 'key-2'},
    })
    now += voicesvc.VOICE_ROOM_TTL_MS + 1
    expect(voice.room('seed-voice-sess-1')).toBeUndefined()
  })

  test('internal routes require the bearer token and a known room', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const routes = voice.routes(silentHost())
    for (const route of [
      '/agents/api/voice/turn',
      '/api/voice/turn',
      '/agents/api/voice/room-config',
      '/api/voice/room-config',
      '/agents/api/voice/leave',
      '/api/voice/leave',
    ]) {
      const handler = getPostHandler(routes, route)
      const anonymous = await handler(post(route, {room: 'seed-voice-x', text: 'hi'}))
      expect(anonymous.status).toBe(401)
      const wrong = await handler(post(route, {room: 'seed-voice-x', text: 'hi'}, 'not-the-token'))
      expect(wrong.status).toBe(401)
    }
    const turn = await getPostHandler(
      routes,
      '/agents/api/voice/turn',
    )(post('/agents/api/voice/turn', {room: 'seed-voice-unknown', text: 'hi'}, TOKEN))
    expect(turn.status).toBe(403)
    expect(await turn.json()).toEqual({error: 'Unknown room'})
    const roomConfig = await getPostHandler(
      routes,
      '/agents/api/voice/room-config',
    )(post('/agents/api/voice/room-config', {room: 'seed-voice-unknown'}, TOKEN))
    expect(roomConfig.status).toBe(403)
    const malformed = await getPostHandler(
      routes,
      '/agents/api/voice/turn',
    )(post('/agents/api/voice/turn', {room: 'seed-voice-unknown'}, TOKEN))
    expect(malformed.status).toBe(400)
  })

  test('room-config hands the worker the room’s keys and pipeline settings; leave forgets the room', async () => {
    const voice = new voicesvc.VoiceService(
      voiceConfig({deepgramModel: 'nova-3', cartesiaModel: 'sonic-3', cartesiaVoice: 'voice-id', language: 'de'}),
      {dispatch: new FakeDispatch()},
    )
    await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'dg-secret', cartesiaApiKey: 'ca-secret'},
    })
    const routes = voice.routes(silentHost())
    const configured = await getPostHandler(
      routes,
      '/api/voice/room-config',
    )(post('/api/voice/room-config', {room: 'seed-voice-sess-1'}, TOKEN))
    expect(configured.status).toBe(200)
    expect(await configured.json()).toEqual({
      sessionId: 'sess-1',
      deepgramApiKey: 'dg-secret',
      cartesiaApiKey: 'ca-secret',
      deepgramModel: 'nova-3',
      cartesiaModel: 'sonic-3',
      cartesiaVoice: 'voice-id',
      language: 'de',
      turnDetector: false,
    })
    const left = await getPostHandler(
      routes,
      '/api/voice/leave',
    )(post('/api/voice/leave', {room: 'seed-voice-sess-1'}, TOKEN))
    expect(left.status).toBe(200)
    expect(await left.json()).toEqual({ok: true})
    expect(voice.room('seed-voice-sess-1')).toBeUndefined()
    const again = await getPostHandler(
      routes,
      '/api/voice/leave',
    )(post('/api/voice/leave', {room: 'seed-voice-sess-1'}, TOKEN))
    expect(again.status).toBe(200)
  })

  test('turn streams the session’s text deltas and finishes on the assistant message', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const calls: unknown[] = []
    const host: voicesvc.VoiceHost = {
      async voiceMessage(storageAccountId, sessionId, text, userOrigin) {
        calls.push({storageAccountId, sessionId, text, userOrigin})
        // The real service appends the user message and runs the turn inline, emitting as it goes.
        await Promise.resolve()
        voice.onServiceEvent(sessionEvent(sessionId, {type: 'message', role: 'user', content: text}))
        voice.onServiceEvent(sessionChange(sessionId, 'streaming'))
        voice.onServiceEvent(partial(sessionId, 'Hello'))
        // Another session's deltas must not leak into this stream.
        voice.onServiceEvent(partial('sess-other', 'WRONG'))
        voice.onServiceEvent(partial(sessionId, ', world'))
        voice.onServiceEvent(partial(sessionId, undefined))
        voice.onServiceEvent(sessionEvent(sessionId, {type: 'message', role: 'assistant', content: 'Hello, world'}))
        voice.onServiceEvent(sessionChange(sessionId, 'idle'))
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: 'evt-assistant'}
      },
    }
    const res = await getPostHandler(
      voice.routes(host),
      '/agents/api/voice/turn',
    )(post('/agents/api/voice/turn', {room: 'seed-voice-sess-1', text: '  what time is it  '}, TOKEN))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-ndjson')
    expect(await readNdjson(res)).toEqual([{delta: 'Hello'}, {delta: ', world'}, {done: true, text: 'Hello, world'}])
    expect(calls).toEqual([
      {
        storageAccountId: 'owner',
        sessionId: 'sess-1',
        text: 'what time is it',
        userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      },
    ])
    expect(voice.hub.listenerCount('sess-1')).toBe(0)
  })

  test('a silent turn (tools, no text) ends with empty text once the session goes idle', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_storageAccountId, sessionId) {
        await Promise.resolve()
        // An idle from BEFORE this turn started must not end the stream.
        voice.onServiceEvent(sessionChange(sessionId, 'idle'))
        voice.onServiceEvent(sessionChange(sessionId, 'streaming'))
        voice.onServiceEvent(sessionChange(sessionId, 'idle'))
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: ''}
      },
    }
    const res = await getPostHandler(
      voice.routes(host),
      '/api/voice/turn',
    )(post('/api/voice/turn', {room: 'seed-voice-sess-1', text: 'do the thing'}, TOKEN))
    expect(await readNdjson(res)).toEqual([{done: true, text: ''}])
    expect(voice.hub.listenerCount('sess-1')).toBe(0)
  })

  test('a turn that never finishes ends at the timeout; a failed turn reports the error', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch(), turnTimeoutMs: 30})
    await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const hanging: voicesvc.VoiceHost = {voiceMessage: () => new Promise(() => {})}
    const timedOut = await getPostHandler(
      voice.routes(hanging),
      '/api/voice/turn',
    )(post('/api/voice/turn', {room: 'seed-voice-sess-1', text: 'hello?'}, TOKEN))
    expect(await readNdjson(timedOut)).toEqual([{done: true, text: ''}])
    expect(voice.hub.listenerCount('sess-1')).toBe(0)

    const failing: voicesvc.VoiceHost = {
      voiceMessage: async () => {
        throw new apisvc.APIError(409, 'Session is already streaming')
      },
    }
    const failed = await getPostHandler(
      voice.routes(failing),
      '/api/voice/turn',
    )(post('/api/voice/turn', {room: 'seed-voice-sess-1', text: 'hello?'}, TOKEN))
    expect(await readNdjson(failed)).toEqual([{error: 'Session is already streaming'}])
    expect(voice.hub.listenerCount('sess-1')).toBe(0)
  })

  test('a client that disconnects mid-turn is unsubscribed', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    await voice.createVoiceSession({
      sessionId: 'sess-1',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key-1'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const hanging: voicesvc.VoiceHost = {voiceMessage: () => new Promise(() => {})}
    const res = await getPostHandler(
      voice.routes(hanging),
      '/api/voice/turn',
    )(post('/api/voice/turn', {room: 'seed-voice-sess-1', text: 'hello?'}, TOKEN))
    expect(voice.hub.listenerCount('sess-1')).toBe(1)
    await res.body!.cancel()
    expect(voice.hub.listenerCount('sess-1')).toBe(0)
  })
})

describe('voice actions', () => {
  test('CreateVoiceSession is 501 on a server without voice, after the session access check', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const svc = new apisvc.Service(db, dataDir)
    try {
      const account = blobs.generateNobleKeyPair()
      const missing = svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateVoiceSession', sessionId: 'nope'}}),
      )
      await expect(missing).rejects.toMatchObject({status: 404})
      const sessionId = await seedSession(svc, account)
      const off = svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateVoiceSession', sessionId}}),
      )
      await expect(off).rejects.toMatchObject({status: 501, message: 'Voice is not available on this server'})
      const settings = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'GetVoiceSettings'}}))
      expect(settings).toEqual({
        _: 'GetVoiceSettingsResponse',
        available: false,
        deepgramApiKey: 'none',
        cartesiaApiKey: 'none',
      })
      const health = await getGetHandler(createAPIRoutes(svc), '/api/health')()
      expect((await health.json()).voice).toBe(false)
    } finally {
      svc.stopRunQueue()
      sqlite.closeDatabase(db)
      cleanup()
    }
  })

  test('voice settings report key sources and account keys override the server’s in room records', async () => {
    const {db, dataDir, cleanup} = createTestState()
    // Deepgram is configured server-wide; Cartesia is still the placeholder.
    const voice = new voicesvc.VoiceService(voiceConfig({deepgramApiKey: 'server-dg-key'}), {
      dispatch: new FakeDispatch(),
    })
    const svc = new apisvc.Service(db, dataDir, {voice})
    try {
      const account = blobs.generateNobleKeyPair()
      const accountId = blobs.principalToString(account.principal)
      const sessionId = await seedSession(svc, account)
      const health = await getGetHandler(createAPIRoutes(svc), '/api/health')()
      expect((await health.json()).voice).toBe(true)

      const initial = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'GetVoiceSettings'}}))
      expect(initial).toEqual({
        _: 'GetVoiceSettingsResponse',
        available: true,
        deepgramApiKey: 'server',
        cartesiaApiKey: 'none',
      })

      const first = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateVoiceSession', sessionId}}),
      )
      if (first._ !== 'CreateVoiceSessionResponse') throw new Error('unexpected response')
      expect(first.room).toBe(`seed-voice-${sessionId}`)
      expect(first.identity).toBe(`user-${accountId}`)
      expect(decodeJwt(first.token).video).toMatchObject({room: `seed-voice-${sessionId}`, roomJoin: true})
      expect(voice.room(first.room)).toMatchObject({
        sessionId,
        storageAccountId: accountId,
        userOrigin: {accountId},
        keys: {deepgramApiKey: 'server-dg-key', cartesiaApiKey: config.VOICE_PLACEHOLDER_KEYS.cartesia},
      })

      const set = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetVoiceSettings', deepgramApiKey: ' my-dg-key ', cartesiaApiKey: 'my-ca-key'},
        }),
      )
      expect(set).toEqual({_: 'SetVoiceSettingsResponse', deepgramApiKey: 'account', cartesiaApiKey: 'account'})
      const stored = db
        .query<{name: string; ciphertext: Uint8Array}, []>(`SELECT name, ciphertext FROM secrets ORDER BY name`)
        .all()
      expect(stored.map((row) => row.name)).toEqual(['voice/cartesia-api-key', 'voice/deepgram-api-key'])
      for (const row of stored) expect(new TextDecoder().decode(row.ciphertext)).not.toContain('my-')

      const reissued = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateVoiceSession', sessionId}}),
      )
      if (reissued._ !== 'CreateVoiceSessionResponse') throw new Error('unexpected response')
      expect(voice.room(reissued.room)?.keys).toEqual({deepgramApiKey: 'my-dg-key', cartesiaApiKey: 'my-ca-key'})

      // Absent fields are untouched; null clears; an empty string is refused.
      const cleared = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'SetVoiceSettings', cartesiaApiKey: null}}),
      )
      expect(cleared).toEqual({_: 'SetVoiceSettingsResponse', deepgramApiKey: 'account', cartesiaApiKey: 'none'})
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {action: {_: 'SetVoiceSettings', deepgramApiKey: '   '}}),
        ),
      ).rejects.toMatchObject({status: 400})
      const both = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'SetVoiceSettings', deepgramApiKey: null}}),
      )
      expect(both).toEqual({_: 'SetVoiceSettingsResponse', deepgramApiKey: 'server', cartesiaApiKey: 'none'})
      expect(db.query(`SELECT name FROM secrets`).all()).toEqual([])
    } finally {
      svc.stopRunQueue()
      sqlite.closeDatabase(db)
      cleanup()
    }
  })
})

function voiceConfig(overrides: Partial<voicesvc.VoiceConfig> = {}): voicesvc.VoiceConfig {
  const base = config.create(config.flags({SEED_AGENTS_VOICE_ENABLED: '1'} as NodeJS.ProcessEnv)).voice
  return {...base, internalToken: TOKEN, ...overrides}
}

class FakeDispatch implements voicesvc.VoiceDispatchClient {
  calls: Array<{room: string; agentName: string; metadata?: string}> = []
  fail?: Error
  async createDispatch(room: string, agentName: string, options?: {metadata?: string}): Promise<unknown> {
    if (this.fail) throw this.fail
    this.calls.push({room, agentName, metadata: options?.metadata})
    return {id: `dispatch-${this.calls.length}`}
  }
}

function silentHost(): voicesvc.VoiceHost {
  return {
    voiceMessage: async () => {
      throw new Error('voiceMessage should not be called')
    },
  }
}

function decodeJwt(token: string): {sub: string; iss: string; exp: number; video: Record<string, unknown>} {
  const [, payload] = token.split('.')
  if (!payload) throw new Error('malformed JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

function post(route: string, body: unknown, token?: string): Request {
  return new Request(`http://agents.test${route}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: JSON.stringify(body),
  })
}

async function readNdjson(res: Response): Promise<unknown[]> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

function partial(sessionId: string, textDelta: string | undefined): apisvc.ServiceEvent {
  return {type: 'session-partial', accountId: 'owner', agentId: 'agent', sessionId, partialId: 'p1', textDelta}
}

function sessionEvent(sessionId: string, payload: api.SessionEventPayload): apisvc.ServiceEvent {
  return {
    type: 'session-event',
    accountId: 'owner',
    agentId: 'agent',
    event: {id: crypto.randomUUID(), sessionId, seq: 1, event: payload, createdAt: Date.now()},
  }
}

function sessionChange(sessionId: string, status: api.SessionInfo['status']): apisvc.ServiceEvent {
  return {
    type: 'session-change',
    accountId: 'owner',
    session: {id: sessionId, status} as api.SessionInfo,
  }
}

/** Provider + agent + session for a signer; returns the session id. */
async function seedSession(svc: apisvc.Service, account: blobs.Signer): Promise<string> {
  await svc.message(
    await apisvc.createSignedEnvelope(account, {
      action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}},
    }),
  )
  const agent = await svc.message(
    await apisvc.createSignedEnvelope(account, {
      action: {
        _: 'CreateAgent',
        definition: {name: 'Voice Agent', systemPrompt: 'Talk.', modelProvider: 'openai', model: 'gpt-test', tools: []},
      },
    }),
  )
  if (agent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  const session = await svc.message(
    await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: agent.agentId}}),
  )
  if (session._ !== 'CreateSessionResponse') throw new Error('unexpected response')
  return session.sessionId
}

function createTestState(): {db: Database; dataDir: string; cleanup: () => void} {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-voice-test-'))
  return {db, dataDir, cleanup: () => fs.rmSync(dataDir, {recursive: true, force: true})}
}

function getPostHandler(
  routes: Bun.Serve.Routes<undefined, string>,
  route: string,
): (req: Request) => Promise<Response> {
  const entry = routes[route] as {POST?: (req: Request) => Promise<Response>} | undefined
  if (!entry?.POST) throw new Error(`missing route ${route}`)
  return entry.POST
}

function getGetHandler(routes: Bun.Serve.Routes<undefined, string>, route: string): () => Response | Promise<Response> {
  const entry = routes[route] as {GET?: () => Response | Promise<Response>} | undefined
  if (!entry?.GET) throw new Error(`missing route ${route}`)
  return entry.GET
}
