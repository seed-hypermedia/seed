/**
 * Voice chat for agent sessions.
 *
 * The browser joins a LiveKit room per session; a speech worker (`voice-worker.ts`, a separate
 * process) joins the same room, transcribes the user, and asks THIS server to run the utterance as
 * a normal session turn, streaming the reply text back to speak. This module owns everything the
 * server side needs for that:
 *
 *  - room tokens + explicit agent dispatch (`createVoiceSession`, behind the signed
 *    `CreateVoiceSession` action),
 *  - the in-memory room registry (which session a room belongs to, who is speaking, which speech
 *    keys apply), expiring after {@link VOICE_ROOM_TTL_MS},
 *  - a small event hub so the turn route can follow a session's streaming deltas,
 *  - the internal HTTP routes the worker calls (bearer-token guarded, see docs/voice.md),
 *  - the worker child-process supervisor used when `SEED_AGENTS_VOICE_WORKER=child`.
 *
 * Nothing here logs key material: room records hold the resolved speech keys and hand them to the
 * worker over the loopback `room-config` route only.
 */
import type * as api from '@/api'
import type * as apisvc from '@/api-service'
import * as config from '@/config'
import {log} from '@/log'
import * as livekit from 'livekit-server-sdk'
import * as nodeCrypto from 'node:crypto'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import {fileURLToPath} from 'node:url'

export type VoiceConfig = config.Config['voice']
export type VoiceProvider = 'deepgram' | 'cartesia'
/** Speech keys resolved for one room (account secret, else server config, else placeholder). */
export type VoiceKeys = {deepgramApiKey: string; cartesiaApiKey: string}
/** The signed account and signer behind the voice participant; stamped on the user messages. */
export type VoiceUserOrigin = {accountId: string; signerId: string}

/** Stable utterance identity and the durable run that owns its response. */
export type VoiceRequestContext = {messageId: string; onRun: (runId: string) => void; screenContext?: string}

/** One issued voice room, kept in memory until `leave` or expiry. */
export type VoiceRoom = {
  room: string
  sessionId: string
  /** Account whose storage holds the session (the agent owner). */
  storageAccountId: string
  userOrigin: VoiceUserOrigin
  keys: VoiceKeys
  createdAt: number
  profile?: VoiceProfile
  worker?: {pid: number; state: string; updatedAt: number; metrics?: Record<string, number>}
}

/** Speech preferences that may change without replacing the call. */
export type VoiceProfile = {voice: string; speed: number}

/** What the worker needs to build its pipeline for a room (answer of `room-config`). */
export type VoiceRoomConfig = {
  sessionId: string
  deepgramApiKey: string
  cartesiaApiKey: string
  deepgramModel: string
  cartesiaModel: string
  cartesiaVoice: string
  cartesiaSpeed?: number
  language: string
  turnDetector: boolean
}

/** The LiveKit dispatch surface used, injectable so tests need no LiveKit server. */
export type VoiceDispatchClient = {
  createDispatch(roomName: string, agentName: string, options?: {metadata?: string}): Promise<unknown>
}

/** The slice of `Service` the internal routes call. */
export type VoiceHost = {
  voiceMessage(
    storageAccountId: string,
    sessionId: string,
    text: string,
    userOrigin: VoiceUserOrigin,
    request?: VoiceRequestContext,
  ): Promise<api.MessageSessionResponse>
}

/** How long a minted participant token stays valid. */
export const VOICE_TOKEN_TTL_MS = 60 * 60 * 1000
/** Room records are forgotten this long after issue even without a `leave`. */
export const VOICE_ROOM_TTL_MS = 2 * 60 * 60 * 1000
/** A turn stream ends with whatever it collected after this long (tool-heavy turns can be slow). */
export const VOICE_TURN_TIMEOUT_MS = 5 * 60 * 1000

/** Room name for a session; one room per session so re-joins land in the same place. */
export function voiceRoomName(sessionId: string): string {
  return `seed-voice-${sessionId}`
}

export type VoiceSessionListener = (event: apisvc.ServiceEvent) => void

/**
 * In-process fan-out of session-scoped service events, keyed by session id. `main.ts` feeds it
 * every `ServiceEvent` alongside the WebSocket publisher; turn streams subscribe to one session.
 */
export class VoiceEventHub {
  readonly #listeners = new Map<string, Set<VoiceSessionListener>>()

  subscribe(sessionId: string, listener: VoiceSessionListener): () => void {
    let set = this.#listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.#listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      const current = this.#listeners.get(sessionId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.#listeners.delete(sessionId)
    }
  }

  emit(event: apisvc.ServiceEvent): void {
    const sessionId = eventSessionId(event)
    if (!sessionId) return
    const set = this.#listeners.get(sessionId)
    if (!set) return
    for (const listener of Array.from(set)) {
      try {
        listener(event)
      } catch (error) {
        log.warn('[voice] session listener failed', {sessionId, error: errorMessage(error)})
      }
    }
  }

  listenerCount(sessionId: string): number {
    return this.#listeners.get(sessionId)?.size ?? 0
  }
}

function eventSessionId(event: apisvc.ServiceEvent): string | undefined {
  switch (event.type) {
    case 'session-partial':
      return event.sessionId
    case 'session-event':
      return event.event.sessionId
    case 'session-change':
      return event.session.id
    case 'run-change':
      return event.run.sessionId
    default:
      return undefined
  }
}

export class VoiceService {
  readonly #activity = new Map<
    string,
    {sessionId: string; partialId: string; text: string; activity?: api.AgentRunActivity; updatedAt: number}
  >()
  readonly #turns = new Map<
    string,
    {text: string; chunks: Uint8Array[]; listeners: Set<ReadableStreamDefaultController<Uint8Array>>; done: boolean}
  >()
  readonly #screenContexts = new Map<string, {text: string; receivedAt: number}>()
  readonly hub = new VoiceEventHub()
  /** Bearer token the worker presents on the internal routes. */
  readonly internalToken: string
  readonly #cfg: VoiceConfig
  readonly #dispatch: VoiceDispatchClient
  readonly #rooms = new Map<string, VoiceRoom>()
  readonly #now: () => number
  readonly #turnTimeoutMs: number
  readonly #recentTurns: {sessionId: string; startedAt: number; elapsedMs: number; outcome: string}[] = []

  constructor(
    cfg: VoiceConfig,
    options: {dispatch?: VoiceDispatchClient; now?: () => number; turnTimeoutMs?: number} = {},
  ) {
    this.#cfg = cfg
    this.#dispatch =
      options.dispatch ?? new livekit.AgentDispatchClient(cfg.livekitUrl, cfg.livekitApiKey, cfg.livekitApiSecret)
    this.#now = options.now ?? Date.now
    this.#turnTimeoutMs = options.turnTimeoutMs ?? VOICE_TURN_TIMEOUT_MS
    this.internalToken = cfg.internalToken ?? nodeCrypto.randomBytes(32).toString('base64url')
  }

  get config(): VoiceConfig {
    return this.#cfg
  }

  /** The server-wide key for a provider (may be the placeholder). */
  serverKey(provider: VoiceProvider): string {
    return provider === 'deepgram' ? this.#cfg.deepgramApiKey : this.#cfg.cartesiaApiKey
  }

  /** Whether the server-wide key for a provider is a real credential. */
  serverKeySource(provider: VoiceProvider): Extract<api.VoiceKeySource, 'server' | 'none'> {
    return config.isVoiceKeyConfigured(this.serverKey(provider)) ? 'server' : 'none'
  }

  /** Feed every service event here (from the `onEvent` callback) so turn streams can follow sessions. */
  onServiceEvent(event: apisvc.ServiceEvent): void {
    if (event.type === 'session-partial') {
      const previous = this.#activity.get(event.sessionId)
      this.#activity.set(event.sessionId, {
        sessionId: event.sessionId,
        partialId: event.partialId,
        text: ((previous?.partialId === event.partialId ? previous.text : '') + (event.textDelta ?? '')).slice(-16000),
        activity: event.activity ?? previous?.activity,
        updatedAt: this.#now(),
      })
      if (this.#activity.size > 100) this.#activity.delete(this.#activity.keys().next().value!)
    }
    this.hub.emit(event)
    if (event.type === 'session-change' && event.session.continuedTo) {
      for (const record of this.#rooms.values()) {
        if (record.storageAccountId === event.accountId && record.sessionId === event.session.id) {
          record.sessionId = event.session.continuedTo.sessionId
        }
      }
    }
  }

  /**
   * Mints a participant token for the session's room, records the room, and asks LiveKit to
   * dispatch the speech worker into it. Re-issuing for the same session replaces the record.
   */
  async createVoiceSession(input: {
    sessionId: string
    storageAccountId: string
    userOrigin: VoiceUserOrigin
    keys: VoiceKeys
  }): Promise<api.CreateVoiceSessionResponse> {
    this.#sweepExpiredRooms()
    const now = this.#now()
    const room = voiceRoomName(input.sessionId)
    const identity = `user-${input.userOrigin.accountId}`
    const accessToken = new livekit.AccessToken(this.#cfg.livekitApiKey, this.#cfg.livekitApiSecret, {
      identity,
      ttl: VOICE_TOKEN_TTL_MS / 1000,
    })
    accessToken.addGrant({roomJoin: true, room, canPublish: true, canSubscribe: true})
    const token = await accessToken.toJwt()
    this.#screenContexts.delete(room)
    this.#rooms.set(room, {
      room,
      sessionId: input.sessionId,
      storageAccountId: input.storageAccountId,
      userOrigin: input.userOrigin,
      keys: input.keys,
      createdAt: now,
    })
    try {
      await this.#dispatch.createDispatch(room, this.#cfg.agentName, {
        metadata: JSON.stringify({sessionId: input.sessionId}),
      })
      log.info('[voice] dispatched worker', {room, sessionId: input.sessionId})
    } catch (error) {
      // The worker may already be in the room (a re-issue), or LiveKit may be unreachable — in
      // which case the browser's own connect will surface the failure. Never fail the token.
      log.warn('[voice] agent dispatch failed', {room, error: errorMessage(error)})
    }
    return {
      _: 'CreateVoiceSessionResponse',
      sessionId: input.sessionId,
      url: this.#cfg.livekitPublicUrl,
      token,
      room,
      identity,
      expiresAt: now + VOICE_TOKEN_TTL_MS,
    }
  }

  /** The live record for a room, or undefined when unknown or expired. */
  room(name: string): VoiceRoom | undefined {
    const record = this.#rooms.get(name)
    if (!record) return undefined
    if (this.#now() - record.createdAt > VOICE_ROOM_TTL_MS) {
      this.#rooms.delete(name)
      return undefined
    }
    return record
  }

  /** Forgets a room (the worker calls `leave` when its job ends). */
  forgetRoom(name: string): boolean {
    this.#screenContexts.delete(name)
    return this.#rooms.delete(name)
  }

  roomConfig(name: string): VoiceRoomConfig | undefined {
    const record = this.room(name)
    if (!record) return undefined
    return {
      sessionId: record.sessionId,
      deepgramApiKey: record.keys.deepgramApiKey,
      cartesiaApiKey: record.keys.cartesiaApiKey,
      deepgramModel: this.#cfg.deepgramModel,
      cartesiaModel: this.#cfg.cartesiaModel,
      cartesiaVoice: record.profile?.voice ?? this.#cfg.cartesiaVoice,
      ...(record.profile ? {cartesiaSpeed: record.profile.speed} : {}),
      language: this.#cfg.language,
      turnDetector: this.#cfg.turnDetector,
    }
  }

  /**
   * The internal routes the worker calls, under both URL prefixes the server serves. All three
   * require `Authorization: Bearer <internalToken>`; unknown rooms are 403.
   */
  routes(host: VoiceHost): Bun.Serve.Routes<undefined, string> {
    const turn = (req: Request) => this.#handleTurn(req, host)
    const roomConfig = (req: Request) => this.#handleRoomConfig(req)
    const leave = (req: Request) => this.#handleLeave(req)
    return {
      '/api/voice/context': {POST: (req: Request) => this.#handleContext(req)},
      '/agents/api/voice/context': {POST: (req: Request) => this.#handleContext(req)},
      '/api/voice/turn': {POST: turn},
      '/agents/api/voice/turn': {POST: turn},
      '/api/voice/room-config': {POST: roomConfig},
      '/agents/api/voice/room-config': {POST: roomConfig},
      '/api/voice/leave': {POST: leave},
      '/agents/api/voice/leave': {POST: leave},
      '/api/voice/runtime': {POST: (req: Request) => this.#handleRuntime(req)},
      '/api/voice/telemetry': {POST: (req: Request) => this.#handleTelemetry(req)},
      '/agents/api/voice/telemetry': {POST: (req: Request) => this.#handleTelemetry(req)},
    }
  }

  /** Receives bounded, content-free observations from worker processes. */
  async #handleTelemetry(req: Request): Promise<Response> {
    const denied = this.#authorize(req)
    if (denied) return denied
    const body = await readJsonBody(req)
    const record = this.room(typeof body?.room === 'string' ? body.room : '')
    if (!record) return Response.json({error: 'Unknown room'}, {status: 403})
    const metrics: Record<string, number> = {}
    if (body?.metrics && typeof body.metrics === 'object') {
      for (const key of [
        'ttftMs',
        'ttfbMs',
        'durationMs',
        'audioDurationMs',
        'charactersCount',
        'endOfUtteranceDelayMs',
      ]) {
        const value = (body.metrics as Record<string, unknown>)[key]
        if (typeof value === 'number' && Number.isFinite(value)) metrics[key] = value
      }
    }
    record.createdAt = this.#now()
    record.worker = {
      pid: typeof body?.pid === 'number' ? body.pid : 0,
      state: typeof body?.state === 'string' ? body.state.slice(0, 50) : record.worker?.state ?? 'running',
      updatedAt: this.#now(),
      metrics: {...record.worker?.metrics, ...metrics},
    }
    return Response.json({ok: true})
  }

  /** Operator-only control and redacted diagnostics; never returns speech credentials. */
  async #handleRuntime(req: Request): Promise<Response> {
    const denied = this.#authorize(req)
    if (denied) return denied
    const body = await readJsonBody(req)
    if (!body) return Response.json({error: 'JSON object required'}, {status: 400})
    const profile = body.profile as Partial<VoiceProfile> | undefined
    if (
      profile &&
      (typeof profile.voice !== 'string' ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(profile.voice) ||
        typeof profile.speed !== 'number' ||
        profile.speed < 0.6 ||
        profile.speed > 2)
    ) {
      return Response.json({error: 'Invalid voice profile'}, {status: 400})
    }
    for (const record of this.#rooms.values()) {
      if (body.room && body.room !== record.room) continue
      if (profile) record.profile = profile as VoiceProfile
      // The authenticated operator validates session access before requesting a switch.
      if (typeof body.sessionId === 'string') record.sessionId = body.sessionId
    }
    this.#sweepExpiredRooms()
    return Response.json({
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      rooms: [...this.#rooms.values()].map(({room, sessionId, createdAt, profile, worker}) => ({
        room,
        sessionId,
        createdAt,
        profile,
        worker,
      })),
      recentTurns: this.#recentTurns,
      activity: [...this.#activity.values()],
    })
  }

  #sweepExpiredRooms(): void {
    const now = this.#now()
    for (const [name, record] of this.#rooms) {
      if (now - record.createdAt > VOICE_ROOM_TTL_MS) {
        this.#rooms.delete(name)
        this.#screenContexts.delete(name)
      }
    }
  }

  #authorize(req: Request): Response | undefined {
    const header = req.headers.get('authorization') ?? ''
    const match = /^Bearer (\S+)$/u.exec(header)
    if (!match || !safeEqual(match[1] ?? '', this.internalToken)) {
      return Response.json({error: 'Unauthorized'}, {status: 401})
    }
    return undefined
  }

  /** One-use, short-lived visible-screen hint. Never log or persist the contents. */
  async #handleContext(req: Request): Promise<Response> {
    const denied = this.#authorize(req)
    if (denied) return denied
    const body = await readJsonBody(req)
    const room = typeof body?.room === 'string' ? body.room : ''
    if (!this.room(room)) return Response.json({error: 'Unknown room'}, {status: 403})
    const text = body?.context
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 2048)
      return Response.json({error: 'context must be 1–2048 UTF-8 bytes'}, {status: 400})
    const capturedAt = body?.capturedAt
    if (
      typeof capturedAt !== 'number' ||
      !Number.isFinite(capturedAt) ||
      capturedAt > this.#now() + 1000 ||
      this.#now() - capturedAt > 10_000
    )
      return Response.json({error: 'context must have a recent capturedAt timestamp'}, {status: 400})
    this.#screenContexts.set(room, {text: text.trim(), receivedAt: this.#now()})
    return Response.json({accepted: true, expiresInMs: 10_000}, {headers: {'Cache-Control': 'no-store'}})
  }

  /**
   * `POST {room, text}` → NDJSON: `{"delta"}` lines as the agent streams, then one
   * `{"done": true, "text"}` line; a failure before any text is `{"error"}` and the stream ends.
   */
  async #handleTurn(req: Request, host: VoiceHost): Promise<Response> {
    const denied = this.#authorize(req)
    if (denied) return denied
    const body = await readJsonBody(req)
    const roomName = typeof body?.room === 'string' ? body.room : ''
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!roomName || !text) return Response.json({error: 'room and text are required'}, {status: 400})
    const record = this.room(roomName)
    if (!record) return Response.json({error: 'Unknown room'}, {status: 403})
    // Active calls renew their lease instead of expiring after two hours of conversation.
    record.createdAt = this.#now()
    log.info('[voice] turn', {room: roomName, sessionId: record.sessionId, textBytes: Buffer.byteLength(text)})
    const messageId = typeof body?.messageId === 'string' ? body.messageId : undefined
    if (messageId !== undefined && !/^[a-zA-Z0-9:_-]{1,200}$/.test(messageId))
      return Response.json({error: 'Invalid messageId'}, {status: 400})
    // Only a new utterance consumes the hint. Replays never consume another screen snapshot.
    const key = messageId ? `${roomName}:${messageId}` : undefined
    const isNewTurn = !key || !this.#turns.has(key)
    const pendingContext = isNewTurn ? this.#screenContexts.get(roomName) : undefined
    if (isNewTurn) this.#screenContexts.delete(roomName)
    const screenContext =
      pendingContext && this.#now() - pendingContext.receivedAt <= 10_000 ? pendingContext.text : undefined
    let stream: ReadableStream<Uint8Array>
    if (messageId) {
      const key = `${roomName}:${messageId}`
      let turn = this.#turns.get(key)
      if (turn && turn.text !== text)
        return Response.json({error: 'Utterance identity reused with different text'}, {status: 409})
      if (!turn) {
        for (const [id, entry] of this.#turns) if (entry.done && this.#turns.size >= 128) this.#turns.delete(id)
        if (this.#turns.size >= 256) return Response.json({error: 'Too many active turns'}, {status: 429})
        turn = {text, chunks: [], listeners: new Set(), done: false}
        this.#turns.set(key, turn)
        const journal = turn
        // HTTP cancellation stops playback, not the durable Seed run. A replay reattaches to
        // the same work instead of appending another user message or executing its tools twice.
        const source = this.#turnStream(record, text, host, new AbortController().signal, messageId, screenContext)
        void (async () => {
          const reader = source.getReader()
          let bytes = 0
          const publish = (chunk: Uint8Array) => {
            journal.chunks.push(chunk)
            for (const listener of journal.listeners) listener.enqueue(chunk)
          }
          try {
            for (;;) {
              const item = await reader.read()
              if (item.done) break
              bytes += item.value.byteLength
              if (bytes > 4_000_000) throw new Error('Voice reply exceeded replay buffer')
              publish(item.value)
            }
          } catch (error) {
            publish(new TextEncoder().encode(JSON.stringify({error: errorMessage(error)}) + '\n'))
          } finally {
            journal.done = true
            for (const listener of journal.listeners) listener.close()
            journal.listeners.clear()
            await reader.cancel()
          }
        })()
      }
      const journal = turn
      let subscriber: ReadableStreamDefaultController<Uint8Array>
      stream = new ReadableStream({
        start(controller) {
          subscriber = controller
          for (const chunk of journal.chunks) controller.enqueue(chunk)
          if (journal.done) controller.close()
          else journal.listeners.add(controller)
        },
        cancel() {
          journal.listeners.delete(subscriber)
        },
      })
    } else stream = this.#turnStream(record, text, host, req.signal, undefined, screenContext)
    return new Response(stream, {
      headers: {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store'},
    })
  }

  #turnStream(
    record: VoiceRoom,
    text: string,
    host: VoiceHost,
    signal: AbortSignal,
    messageId: string = crypto.randomUUID(),
    screenContext?: string,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    let finished = false
    let started = false
    let collected = ''
    let finalText: string | undefined
    let unsubscribe: () => void = () => {}
    let timeout: ReturnType<typeof setTimeout> | undefined
    let toolFeedbackTimer: ReturnType<typeof setTimeout> | undefined
    let toolFeedbackSent = false
    let pendingToolCallId: string | undefined
    let onAbort: () => void = () => {}
    const startedAt = this.#now()
    let followedContinuation = false
    let sentProfile = ''
    let runId: string | undefined
    let tracksRuns = false

    const cleanup = () => {
      unsubscribe()
      if (timeout) clearTimeout(timeout)
      if (toolFeedbackTimer) clearTimeout(toolFeedbackTimer)
      signal.removeEventListener('abort', onAbort)
    }

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const write = (line: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
          } catch {
            /* the consumer went away; the abort path closes out */
          }
        }
        const finish = (line: Record<string, unknown>) => {
          if (finished) return
          finished = true
          this.#recentTurns.push({
            sessionId: record.sessionId,
            startedAt,
            elapsedMs: this.#now() - startedAt,
            outcome: line.error ? 'error' : 'completed',
          })
          if (this.#recentTurns.length > 100) this.#recentTurns.shift()
          write(line)
          cleanup()
          try {
            controller.close()
          } catch {
            /* already closed by cancel */
          }
        }
        const done = () => finish({done: true, text: finalText ?? collected})
        onAbort = () => {
          if (finished) return
          finished = true
          cleanup()
          log.info('[voice] turn aborted by client', {sessionId: record.sessionId})
        }
        signal.addEventListener('abort', onAbort)

        // Subscribe BEFORE the message is appended: the interactive run executes inline inside
        // `voiceMessage`, so every delta is emitted before that call returns.
        const listener: VoiceSessionListener = (event) => {
          if (event.type === 'run-change') {
            if (tracksRuns && followedContinuation && !runId && !event.run.parentRunId) runId = event.run.id
            if (event.run.id !== runId) return
            write({status: event.run.status, runId})
            if (event.run.status === 'failed') finish({error: event.run.error?.message ?? 'Agent run failed'})
            else if (event.run.status === 'canceled') finish({error: 'Agent run stopped'})
            else if (event.run.status === 'succeeded') done()
            return
          }
          if (event.type === 'session-partial') {
            if (tracksRuns && event.runId !== runId) return
            started = true
            // Only acknowledge actual tool work, not model thinking or a queued run. A short
            // delay avoids talking over quick tools; this line is speech-only, not a session reply.
            if (event.activity?.phase === 'tool' && !toolFeedbackSent && !finished) {
              const toolCallId = event.activity.toolCallId
              if (!toolFeedbackTimer || (toolCallId && toolCallId !== pendingToolCallId)) {
                if (toolFeedbackTimer) clearTimeout(toolFeedbackTimer)
                pendingToolCallId = toolCallId
                toolFeedbackTimer = setTimeout(() => {
                  toolFeedbackTimer = undefined
                  if (finished) return
                  toolFeedbackSent = true
                  write({progress: 'I’m checking that now.'})
                }, 1500)
              }
            } else if (event.activity || event.textDelta) {
              if (toolFeedbackTimer) clearTimeout(toolFeedbackTimer)
              toolFeedbackTimer = undefined
            }
            if (event.textDelta) {
              const profile = record.profile
              if (profile && JSON.stringify(profile) !== sentProfile) {
                sentProfile = JSON.stringify(profile)
                write({voice: profile})
              }
              collected += event.textDelta
              write({delta: event.textDelta})
            }
            return
          }
          if (event.type === 'session-event') {
            if (tracksRuns) return
            const payload = event.event.event
            if (payload.type !== 'message') return
            if (payload.role === 'user') started = true
            else if (payload.role === 'assistant') {
              finalText = typeof payload.content === 'string' ? payload.content : collected
              // An assistant message can be a prelude before tool calls. Keep listening until
              // the run is idle (or its completion promise settles), including the tool result.
            }
            return
          }
          if (event.type === 'session-change') {
            if (event.session.continuedTo) {
              followedContinuation = true
              runId = undefined
              record.sessionId = event.session.continuedTo.sessionId
              unsubscribe()
              unsubscribe = this.hub.subscribe(record.sessionId, listener)
              return
            }
            const status = event.session.status
            if (status === 'streaming') started = true
            else if (!tracksRuns && started && (status === 'idle' || status === 'stopped' || status === 'error')) done()
          }
        }
        unsubscribe = this.hub.subscribe(record.sessionId, listener)
        timeout = setTimeout(() => {
          log.warn('[voice] turn timed out', {sessionId: record.sessionId})
          finish({error: 'The agent is still working. Check its run in the app; your message has not been resent.'})
        }, this.#turnTimeoutMs)

        host
          .voiceMessage(record.storageAccountId, record.sessionId, text, record.userOrigin, {
            messageId,
            screenContext,
            onRun(id) {
              runId = id
              tracksRuns = true
            },
          })
          .then(
            (result) => {
              // Empty ids denote queued/parked work: keep following real runtime events. In
              // particular, a one-second grace timer would cut off any slow host tool or handoff.
              if (!finished && !followedContinuation && result.assistantEventId) done()
            },
            (error: unknown) => {
              if (finished) return
              const message = errorMessage(error)
              log.warn('[voice] turn failed', {sessionId: record.sessionId, error: message})
              finish({error: message})
            },
          )
      },
      cancel: () => {
        onAbort()
      },
    })
  }

  /** `POST {room}` → {@link VoiceRoomConfig}; the worker asks once per job before building its pipeline. */
  async #handleRoomConfig(req: Request): Promise<Response> {
    const denied = this.#authorize(req)
    if (denied) return denied
    const body = await readJsonBody(req)
    const roomName = typeof body?.room === 'string' ? body.room : ''
    if (!roomName) return Response.json({error: 'room is required'}, {status: 400})
    const roomConfig = this.roomConfig(roomName)
    if (!roomConfig) return Response.json({error: 'Unknown room'}, {status: 403})
    return Response.json(roomConfig)
  }

  /** `POST {room}` → `{ok: true}`; forgets the room (idempotent). */
  async #handleLeave(req: Request): Promise<Response> {
    const denied = this.#authorize(req)
    if (denied) return denied
    const body = await readJsonBody(req)
    const roomName = typeof body?.room === 'string' ? body.room : ''
    if (!roomName) return Response.json({error: 'room is required'}, {status: 400})
    const forgotten = this.forgetRoom(roomName)
    if (forgotten) log.info('[voice] room left', {room: roomName})
    return Response.json({ok: true})
  }
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await req.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.byteLength !== right.byteLength) return false
  return nodeCrypto.timingSafeEqual(left, right)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------------------------
// Worker child process
// ---------------------------------------------------------------------------------------------

export type VoiceWorkerHandle = {
  /** Stops supervising and terminates the child (SIGTERM, then SIGKILL after a grace period). */
  stop(): Promise<void>
}

/**
 * Resolves the worker entry beside this module: `voice-worker.js` in the bundled build (Bun.build
 * emits it as a sibling of main.js), `voice-worker.ts` from source in dev.
 */
export function voiceWorkerEntryPath(): string {
  for (const ext of ['js', 'ts'] as const) {
    const candidate = fileURLToPath(new URL(`./voice-worker.${ext}`, import.meta.url))
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      /* fall through */
    }
  }
  return fileURLToPath(new URL('./voice-worker.ts', import.meta.url))
}

/** The bun executable to run the worker with: this process when it is bun, else one on PATH. */
function bunExecutable(): string {
  if (nodePath.basename(process.execPath).toLowerCase().startsWith('bun')) return process.execPath
  return Bun.which('bun') ?? 'bun'
}

/** Environment the worker needs: the resolved voice config (flags included) plus how to reach us. */
export function voiceWorkerEnv(
  cfg: VoiceConfig,
  opts: {serverUrl: string; internalToken: string},
): Record<string, string | undefined> {
  return {
    ...(process.env as Record<string, string | undefined>),
    SEED_AGENTS_VOICE_ENABLED: '1',
    SEED_AGENTS_VOICE_SERVER_URL: opts.serverUrl,
    SEED_AGENTS_VOICE_INTERNAL_TOKEN: opts.internalToken,
    SEED_AGENTS_LIVEKIT_URL: cfg.livekitUrl,
    SEED_AGENTS_LIVEKIT_PUBLIC_URL: cfg.livekitPublicUrl,
    SEED_AGENTS_LIVEKIT_API_KEY: cfg.livekitApiKey,
    SEED_AGENTS_LIVEKIT_API_SECRET: cfg.livekitApiSecret,
    SEED_AGENTS_DEEPGRAM_MODEL: cfg.deepgramModel,
    SEED_AGENTS_CARTESIA_MODEL: cfg.cartesiaModel,
    SEED_AGENTS_CARTESIA_VOICE: cfg.cartesiaVoice,
    SEED_AGENTS_VOICE_LANGUAGE: cfg.language,
    SEED_AGENTS_VOICE_TURN_DETECTOR: cfg.turnDetector ? '1' : '0',
  }
}

/**
 * Spawns the speech worker as a child of this process and keeps it running: exits restart it with
 * exponential backoff (1s … 30s, reset after a minute of uptime); `stop()` ends supervision.
 */
export function startVoiceWorker(
  cfg: VoiceConfig,
  opts: {serverUrl: string; internalToken: string},
): VoiceWorkerHandle {
  const entry = voiceWorkerEntryPath()
  // The @livekit/agents CLI subcommands: `dev` (hot reload, verbose) from source, `start` in prod.
  const mode = entry.endsWith('.ts') ? 'dev' : 'start'
  const env = voiceWorkerEnv(cfg, opts)
  let child: Bun.Subprocess | undefined
  let stopped = false
  let attempt = 0
  let restartTimer: ReturnType<typeof setTimeout> | undefined

  const spawn = () => {
    if (stopped) return
    const startedAt = Date.now()
    try {
      child = Bun.spawn([bunExecutable(), 'run', entry, mode], {
        env,
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
      })
    } catch (error) {
      log.error('[voice] worker spawn failed', {entry, error: errorMessage(error)})
      scheduleRestart()
      return
    }
    log.info('[voice] worker started', {pid: child.pid, entry, mode})
    const current = child
    current.exited.then((code) => {
      if (child === current) child = undefined
      if (stopped) return
      if (Date.now() - startedAt > 60_000) attempt = 0
      log.warn('[voice] worker exited', {code, pid: current.pid})
      scheduleRestart()
    })
  }
  const scheduleRestart = () => {
    if (stopped) return
    const delay = Math.min(30_000, 1_000 * 2 ** attempt)
    attempt += 1
    log.info('[voice] worker restart scheduled', {inMs: delay})
    restartTimer = setTimeout(spawn, delay)
  }

  spawn()

  return {
    async stop() {
      stopped = true
      if (restartTimer) clearTimeout(restartTimer)
      const current = child
      if (!current) return
      current.kill('SIGTERM')
      let forceTimer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        current.exited,
        new Promise<void>((resolve) => {
          forceTimer = setTimeout(() => {
            current.kill('SIGKILL')
            resolve()
          }, 5_000)
        }),
      ])
      if (forceTimer) clearTimeout(forceTimer)
    },
  }
}
