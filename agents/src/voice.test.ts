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
  test('shared agent streams each spoken fragment once while every collaborator still receives it', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch(), turnTimeoutMs: 1000})
    const delivered: apisvc.ServiceEvent[] = []
    const svc = new apisvc.Service(db, dataDir, {voice, onEvent: (event) => delivered.push(event)})
    try {
      const owner = blobs.generateNobleKeyPair(),
        writer = blobs.generateNobleKeyPair()
      const ownerId = blobs.principalToString(owner.principal),
        writerId = blobs.principalToString(writer.principal)
      const sessionId = await seedSession(svc, owner)
      const session = await svc.message(
        await apisvc.createSignedEnvelope(owner, {action: {_: 'GetSession', sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw Error('unexpected response')
      const agentId = session.session.agentId
      await svc.message(
        await apisvc.createSignedEnvelope(owner, {
          action: {_: 'InviteAgentCollaborator', agentId, accountId: writerId, role: 'writer'},
        }),
      )
      await svc.message(await apisvc.createSignedEnvelope(writer, {action: {_: 'AcceptAgentInvite', agentId}}))
      await svc.message(
        await apisvc.createSignedEnvelope(owner, {
          action: {_: 'SetSecret', name: 'test-key', value: new TextEncoder().encode('test')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(owner, {
          action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'test-key'}}},
        }),
      )
      // A real Service run and real collaborator fan-out; only the remote model is substituted.
      globalThis.fetch = (async () =>
        new Response(
          [
            {id: 'response', choices: [{delta: {role: 'assistant', content: 'Yes, I’m receiving you. '}}]},
            {id: 'response', choices: [{delta: {content: 'Can you hear this reply clearly?'}}]},
            {
              id: 'response',
              choices: [{delta: {}, finish_reason: 'stop'}],
              usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20},
            },
          ]
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
            .join('') + 'data: [DONE]\n\n',
          {headers: {'Content-Type': 'text/event-stream'}},
        )) as unknown as typeof fetch
      const room = await voice.createVoiceSession({
        sessionId,
        storageAccountId: ownerId,
        userOrigin: {accountId: writerId, signerId: writerId},
        keys: {deepgramApiKey: 'test', cartesiaApiKey: 'test'},
      })
      const response = await getPostHandler(
        voice.routes(svc),
        '/api/voice/turn',
      )(post('/api/voice/turn', {room: room.room, text: 'Can you hear me?', messageId: 'shared-utterance'}, TOKEN))
      const lines = (await readNdjson(response)) as Array<{delta?: string; done?: boolean; text?: string}>
      const expected = 'Yes, I’m receiving you. Can you hear this reply clearly?'
      expect(lines.map((line) => line.delta || '').join('')).toBe(expected)
      expect(lines.at(-1)).toEqual({done: true, text: expected})
      for (const accountId of [ownerId, writerId]) {
        expect(
          delivered
            .filter((event) => event.accountId === accountId && event.type === 'session-partial')
            .map((event) => (event.type === 'session-partial' ? event.textDelta || '' : ''))
            .join(''),
        ).toBe(expected)
      }
      const runtime = await getPostHandler(
        voice.routes(svc),
        '/api/voice/runtime',
      )(post('/api/voice/runtime', {}, TOKEN))
      expect(((await runtime.json()) as any).activity.find((item: any) => item.sessionId === sessionId).text).toBe(
        expected,
      )
    } finally {
      await svc.awaitQueueIdle()
      svc.stopRunQueue()
      globalThis.fetch = originalFetch
      sqlite.closeDatabase(db)
      cleanup()
    }
  })

  test('duplicate turn subscriptions replay once even after the first listener disconnects', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const room = await voice.createVoiceSession({
      sessionId: 's',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    let calls = 0
    let complete!: () => void
    const gate = new Promise<void>((resolve) => {
      complete = resolve
    })
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_owner, sessionId, _text, _origin, request) {
        calls++
        expect(request?.messageId).toBe('utterance-1')
        voice.onServiceEvent(partial(sessionId, 'Hello '))
        await gate
        voice.onServiceEvent(partial(sessionId, 'again'))
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: 'answer'}
      },
    }
    const handler = getPostHandler(voice.routes(host), '/api/voice/turn')
    const body = {room: room.room, text: 'hello', messageId: 'utterance-1'}
    const first = await handler(post('/api/voice/turn', body, TOKEN))
    const reader = first.body!.getReader()
    await reader.read()
    await reader.cancel()
    const second = await handler(post('/api/voice/turn', body, TOKEN))
    const collision = await handler(post('/api/voice/turn', {...body, text: 'different'}, TOKEN))
    expect(collision.status).toBe(409)
    complete()
    const lines = await readNdjson(second)
    expect(lines).toEqual([{delta: 'Hello '}, {delta: 'again'}, {done: true, text: 'Hello again'}])
    expect(await readNdjson(await handler(post('/api/voice/turn', body, TOKEN)))).toEqual(lines)
    expect(calls).toBe(1)
  })

  test('acknowledges a slow tool once, without adding the speech to the stored reply', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const room = await voice.createVoiceSession({
      sessionId: 'slow-tool',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_owner, sessionId) {
        voice.onServiceEvent({
          ...partial(sessionId, undefined),
          activity: {phase: 'tool', toolName: 'search', toolCallId: 'call-1'},
        })
        // Progress updates for the same tool must not perpetually reset the delay.
        await Bun.sleep(100)
        voice.onServiceEvent({
          ...partial(sessionId, undefined),
          activity: {phase: 'tool', toolName: 'search', toolCallId: 'call-1'},
        })
        await Bun.sleep(1500)
        voice.onServiceEvent(partial(sessionId, 'Here is the answer.'))
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: 'answer'}
      },
    }
    const handler = getPostHandler(voice.routes(host), '/api/voice/turn')
    const body = {room: room.room, text: 'find it', messageId: 'slow-tool-1'}
    const lines = await readNdjson(await handler(post('/api/voice/turn', body, TOKEN)))
    expect(lines).toEqual([
      {progress: 'I’m checking that now.'},
      {delta: 'Here is the answer.'},
      {done: true, text: 'Here is the answer.'},
    ])
    expect(await readNdjson(await handler(post('/api/voice/turn', body, TOKEN)))).toEqual(lines)
  })

  test('does not interrupt a quick tool with an acknowledgment', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const room = await voice.createVoiceSession({
      sessionId: 'fast-tool',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_owner, sessionId) {
        voice.onServiceEvent({...partial(sessionId, undefined), activity: {phase: 'tool', toolName: 'read'}})
        await Bun.sleep(25)
        voice.onServiceEvent(partial(sessionId, 'Done.'))
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: 'answer'}
      },
    }
    const handler = getPostHandler(voice.routes(host), '/api/voice/turn')
    expect(await readNdjson(await handler(post('/api/voice/turn', {room: room.room, text: 'read'}, TOKEN)))).toEqual([
      {delta: 'Done.'},
      {done: true, text: 'Done.'},
    ])
  })

  test('queued voice waits for its own run and ignores an earlier turn completing', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const room = await voice.createVoiceSession({
      sessionId: 's',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const run = (id: string, status: api.RunInfo['status']) =>
      voice.onServiceEvent({
        type: 'run-change',
        accountId: 'owner',
        run: {id, sessionId: 's', agentId: 'agent', status} as api.RunInfo,
      })
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_owner, sessionId, _text, _origin, request) {
        request!.onRun('new-run')
        voice.onServiceEvent({...partial(sessionId, 'WRONG'), runId: 'old-run'})
        run('old-run', 'succeeded')
        voice.onServiceEvent(sessionChange(sessionId, 'idle'))
        voice.onServiceEvent({...partial(sessionId, 'Correct reply'), runId: 'new-run'})
        run('new-run', 'succeeded')
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: ''}
      },
    }
    const response = await getPostHandler(
      voice.routes(host),
      '/api/voice/turn',
    )(post('/api/voice/turn', {room: room.room, text: 'queued'}, TOKEN))
    const lines = await readNdjson(response)
    expect(lines).toEqual([
      {delta: 'Correct reply'},
      {status: 'succeeded', runId: 'new-run'},
      {done: true, text: 'Correct reply'},
    ])
  })

  test('speech continues after a tool prelude and waits for the actual final reply', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const issued = await voice.createVoiceSession({
      sessionId: 'tools',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_owner, sessionId) {
        voice.onServiceEvent(partial(sessionId, 'Checking. '))
        voice.onServiceEvent(sessionEvent(sessionId, {type: 'message', role: 'assistant', content: 'Checking.'}))
        await Promise.resolve()
        voice.onServiceEvent(partial(sessionId, 'It worked.'))
        voice.onServiceEvent(sessionEvent(sessionId, {type: 'message', role: 'assistant', content: 'It worked.'}))
        voice.onServiceEvent(sessionChange(sessionId, 'idle'))
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: 'last'}
      },
    }
    const response = await getPostHandler(
      voice.routes(host),
      '/api/voice/turn',
    )(post('/api/voice/turn', {room: issued.room, text: 'Check it'}, TOKEN))
    expect(await readNdjson(response)).toEqual([
      {delta: 'Checking. '},
      {delta: 'It worked.'},
      {done: true, text: 'It worked.'},
    ])
  })

  test('a call follows continuation events and sends the next utterance to the successor', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const issued = await voice.createVoiceSession({
      sessionId: 'first',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const sessions: string[] = []
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_owner, id) {
        sessions.push(id)
        if (id === 'first') {
          const change = sessionChange('first', 'streaming')
          if (change.type === 'session-change')
            change.session.continuedTo = {
              sessionId: 'second',
              continuationId: 'edge',
              reason: 'user_request',
              createdAt: Date.now(),
            }
          voice.onServiceEvent(change)
          voice.onServiceEvent(sessionChange('first', 'idle'))
        }
        voice.onServiceEvent(partial('second', 'Still here'))
        voice.onServiceEvent(sessionEvent('second', {type: 'message', role: 'assistant', content: 'Still here'}))
        voice.onServiceEvent(sessionChange('second', 'idle'))
        return {_: 'MessageSessionResponse', sessionId: id, assistantEventId: 'answer'}
      },
    }
    const turn = getPostHandler(voice.routes(host), '/api/voice/turn')
    for (let i = 0; i < 2; i++) {
      const result = await turn(post('/api/voice/turn', {room: issued.room, text: 'hello'}, TOKEN))
      expect(await readNdjson(result)).toEqual([{delta: 'Still here'}, {done: true, text: 'Still here'}])
    }
    expect(sessions).toEqual(['first', 'second'])
    expect(voice.hub.listenerCount('first')).toBe(0)
    expect(voice.hub.listenerCount('second')).toBe(0)
  })

  test('runtime controls require authentication, validate profiles, and omit speech secrets', async () => {
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch()})
    const issued = await voice.createVoiceSession({
      sessionId: 'first',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'SECRET-DG', cartesiaApiKey: 'SECRET-CA'},
    })
    const control = getPostHandler(voice.routes(silentHost()), '/api/voice/runtime')
    expect((await control(post('/api/voice/runtime', {}))).status).toBe(401)
    expect((await control(post('/api/voice/runtime', {profile: {voice: 'id', speed: 100}}, TOKEN))).status).toBe(400)
    const result = await control(
      post(
        '/api/voice/runtime',
        {room: issued.room, profile: {voice: 'new-voice', speed: 0.9}, sessionId: 'resumed'},
        TOKEN,
      ),
    )
    const body = await result.text()
    expect(body).not.toContain('SECRET')
    expect(voice.room(issued.room)?.sessionId).toBe('resumed')
    expect(voice.roomConfig(issued.room)?.cartesiaVoice).toBe('new-voice')
  })

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
    expect(await readNdjson(timedOut)).toEqual([
      {error: 'The agent is still working. Check its run in the app; your message has not been resent.'},
    ])
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

function partial(
  sessionId: string,
  textDelta: string | undefined,
): Extract<apisvc.ServiceEvent, {type: 'session-partial'}> {
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

describe('voice visible-screen context', () => {
  test('requires auth, bounded fresh data, consumes once and does not reuse on replay', async () => {
    let now = 1_000_000
    const voice = new voicesvc.VoiceService(voiceConfig(), {dispatch: new FakeDispatch(), now: () => now})
    const issued = await voice.createVoiceSession({
      sessionId: 's',
      storageAccountId: 'owner',
      userOrigin: {accountId: 'speaker', signerId: 'key'},
      keys: {deepgramApiKey: 'dg', cartesiaApiKey: 'ca'},
    })
    const route = getPostHandler(
      voice.routes({
        async voiceMessage(_a, sessionId) {
          return {_: 'MessageSessionResponse', sessionId, assistantEventId: 'done'}
        },
      }),
      '/api/voice/context',
    )
    expect(
      (await route(post('/api/voice/context', {room: issued.room, context: 'Notes', capturedAt: now}, 'wrong'))).status,
    ).toBe(401)
    expect(
      (await route(post('/api/voice/context', {room: issued.room, context: 'x'.repeat(2049), capturedAt: now}, TOKEN)))
        .status,
    ).toBe(400)
    expect(
      (await route(post('/api/voice/context', {room: issued.room, context: 'Notes', capturedAt: now - 11000}, TOKEN)))
        .status,
    ).toBe(400)
    const received: Array<string | undefined> = []
    const host: voicesvc.VoiceHost = {
      async voiceMessage(_a, sessionId, _t, _o, request) {
        received.push(request?.screenContext)
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: 'done'}
      },
    }
    expect(
      (await route(post('/api/voice/context', {room: issued.room, context: 'Notes', capturedAt: now}, TOKEN))).status,
    ).toBe(200)
    const turn = getPostHandler(voice.routes(host), '/api/voice/turn')
    await readNdjson(await turn(post('/api/voice/turn', {room: issued.room, text: 'first', messageId: 'one'}, TOKEN)))
    await readNdjson(await turn(post('/api/voice/turn', {room: issued.room, text: 'first', messageId: 'one'}, TOKEN)))
    await readNdjson(await turn(post('/api/voice/turn', {room: issued.room, text: 'second', messageId: 'two'}, TOKEN)))
    expect(received).toEqual(['Notes', undefined])
    await route(post('/api/voice/context', {room: issued.room, context: 'Old', capturedAt: now}, TOKEN))
    now += 10001
    await readNdjson(await turn(post('/api/voice/turn', {room: issued.room, text: 'third', messageId: 'three'}, TOKEN)))
    expect(received.at(-1)).toBeUndefined()
  })
})
