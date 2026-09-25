/**
 * LiveKit agents worker for voice sessions — the second process of the agents server.
 *
 * Registers with the LiveKit server as agent `seed-voice` and waits for explicit dispatches
 * (`VoiceService.createVoiceSession` in the server creates one per room). For each job it joins
 * the room and runs the pipeline
 *
 *   browser mic → Silero VAD → Deepgram STT → [LiveKit turn detector] → SeedSessionLLM → Cartesia TTS
 *
 * where {@link SeedSessionLLM} is the real Seed agent session reached through the server's internal
 * voice routes (see voice-session-llm.ts). The worker never sees API keys from its own config: it
 * asks the server for the room's settings (`room-config`) once per job, so per-account keys and the
 * server defaults are resolved in one place.
 *
 * Runs as `bun src/voice-worker.ts dev` in development (the `voice` mprocs pane) or is spawned by
 * main.ts as `bun run --no-install voice-worker.js start` in production. `download-files` fetches
 * the optional turn-detector ONNX models (`bun run download-voice-models`, an operator step — the
 * models are not baked into the Docker image).
 *
 * Environment (the same names the server's config uses; never logged):
 *   SEED_AGENTS_VOICE_INTERNAL_TOKEN  bearer token for the internal voice routes (required)
 *   SEED_AGENTS_VOICE_SERVER_URL      agents server base URL (default http://127.0.0.1:<SEED_AGENTS_HTTP_PORT|3050>)
 *   SEED_AGENTS_LIVEKIT_URL           LiveKit websocket URL (default ws://localhost:7880)
 *   SEED_AGENTS_LIVEKIT_API_KEY / SEED_AGENTS_LIVEKIT_API_SECRET  (defaults devkey / secret, the `livekit-server --dev` pair)
 *   SEED_AGENTS_VOICE_TURN_DETECTOR   truthy loads the local turn-detector model plugin (needs the downloaded models)
 */
import {cli, defineAgent, ServerOptions, voice, type JobContext, type VAD} from '@livekit/agents'
import * as cartesia from '@livekit/agents-plugin-cartesia'
import * as deepgram from '@livekit/agents-plugin-deepgram'
import * as silero from '@livekit/agents-plugin-silero'
import * as os from 'node:os'
import process from 'node:process'
import {SeedSessionLLM, VoiceServerClient, type VoiceRoomConfig} from './voice-session-llm'

const AGENT_NAME = 'seed-voice'

/** The LiveKit Agent needs instructions, but SeedSessionLLM ignores them: the session has its own. */
const INSTRUCTIONS = 'You are the voice of a Seed agent. Replies are produced by the agent session.'

const Events = voice.AgentSessionEventTypes

function ts(): string {
  return new Date().toISOString().slice(11, 23)
}

function fmtMs(ms: number): string {
  return `${Math.round(ms)}ms`
}

function fmtMem(): string {
  const mem = process.memoryUsage()
  return `rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB`
}

function logLine(tag: string, message: string): void {
  console.log(`[${ts()}] [voice:${tag}] ${message}`)
}

function logError(tag: string, message: string, err?: unknown): void {
  const detail =
    err instanceof Error
      ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
      : err !== undefined
        ? JSON.stringify(err)
        : ''
  console.error(`[${ts()}] [voice:${tag}] ${message}${detail ? ` ${detail}` : ''}`)
}

function readEnv(): {serverUrl: string; token: string; livekitUrl: string; apiKey: string; apiSecret: string} {
  const port = process.env.SEED_AGENTS_HTTP_PORT?.trim() || '3050'
  const serverUrl = process.env.SEED_AGENTS_VOICE_SERVER_URL?.trim() || `http://127.0.0.1:${port}`
  const token = process.env.SEED_AGENTS_VOICE_INTERNAL_TOKEN?.trim() ?? ''
  // `download-files` only fetches model files; it never talks to the server.
  if (!token && !process.argv.includes('download-files')) {
    console.error(
      'voice worker: SEED_AGENTS_VOICE_INTERNAL_TOKEN is not set. The worker needs the shared secret the agents server ' +
        'guards its internal voice routes with (set SEED_AGENTS_VOICE_INTERNAL_TOKEN to the same value in both processes).',
    )
    process.exit(1)
  }
  return {
    serverUrl,
    token,
    livekitUrl: process.env.SEED_AGENTS_LIVEKIT_URL?.trim() || 'ws://localhost:7880',
    apiKey: process.env.SEED_AGENTS_LIVEKIT_API_KEY?.trim() || 'devkey',
    apiSecret: process.env.SEED_AGENTS_LIVEKIT_API_SECRET?.trim() || 'secret',
  }
}

const env = readEnv()
const client = new VoiceServerClient({serverUrl: env.serverUrl, token: env.token})

/**
 * Bun swaps the `ws` package for its own implementation, which lacks the `unexpected-response`
 * event the speech plugins listen for on a rejected handshake (bad API key, 4xx). The rejection
 * then surfaces as an `error` event after the plugin already removed its listener, which Node's
 * EventEmitter turns into an uncaught ERR_UNHANDLED_ERROR — and that would take the whole job
 * process, i.e. the live call, down. Log it and keep going; the plugin's own retry/error path
 * still runs and closes the session cleanly. Anything else stays fatal, as before.
 */
process.on('uncaughtException', (err: Error & {code?: string}) => {
  if (err.code === 'ERR_UNHANDLED_ERROR') {
    logError('error', 'unhandled websocket error event (ignored):', err.message)
    return
  }
  logError('error', 'uncaught exception, exiting:', err)
  process.exit(1)
})

/**
 * The LiveKit turn-detector plugin registers its ONNX inference runners the moment it is imported,
 * and the worker's inference process then loads the models at startup — fatally, when they were
 * never downloaded. So the plugin is only loaded when the operator turned the detector on (or is
 * downloading its models); rooms that ask for it while the worker has it off fall back to VAD.
 */
const TURN_DETECTOR_ENABLED = /^(1|true|yes|on)$/i.test(process.env.SEED_AGENTS_VOICE_TURN_DETECTOR?.trim() ?? '')
const livekitPlugin =
  TURN_DETECTOR_ENABLED || process.argv.includes('download-files')
    ? await import('@livekit/agents-plugin-livekit')
    : undefined

function parseSessionId(metadata: string | undefined): string | undefined {
  if (!metadata) return undefined
  try {
    const parsed = JSON.parse(metadata) as {sessionId?: unknown}
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined
  } catch {
    return undefined
  }
}

function describeConfig(config: VoiceRoomConfig): string {
  return (
    `session=${config.sessionId} stt=deepgram/${config.deepgramModel} tts=cartesia/${config.cartesiaModel} ` +
    `voice=${config.cartesiaVoice || '(default)'} language=${config.language} turnDetector=${
      config.turnDetector ? 'on' : 'off'
    } ` +
    `deepgramKey=${config.deepgramApiKey ? 'set' : 'MISSING'} cartesiaKey=${config.cartesiaApiKey ? 'set' : 'MISSING'}`
  )
}

async function runJob(ctx: JobContext<{vad?: VAD}>): Promise<void> {
  logLine('entry', `job ${ctx.job.id} received, connecting to room...`)
  try {
    await ctx.connect()
  } catch (err) {
    logError('error', 'failed to connect to room:', err)
    throw err
  }
  const room = ctx.room.name ?? ctx.job.room?.name ?? ''
  const sessionId = parseSessionId(ctx.job.metadata)
  logLine('entry', `connected to room ${room} (metadata session=${sessionId ?? 'none'})`)
  for (const [, p] of ctx.room.remoteParticipants) logLine('room', `participant already in room: ${p.identity}`)

  let config: VoiceRoomConfig
  try {
    config = await client.roomConfig(room)
  } catch (err) {
    logError('error', `room-config failed for ${room}:`, err)
    throw err
  }
  if (sessionId && sessionId !== config.sessionId) {
    logLine(
      'entry',
      `dispatch metadata session ${sessionId} differs from room-config session ${config.sessionId}; using room-config`,
    )
  }
  logLine('entry', describeConfig(config))

  const vad = ctx.proc.userData.vad ?? (await silero.VAD.load())
  let turnDetector:
    | InstanceType<typeof import('@livekit/agents-plugin-livekit').turnDetector.MultilingualModel>
    | undefined
  if (config.turnDetector && livekitPlugin) {
    turnDetector = new livekitPlugin.turnDetector.MultilingualModel()
  } else if (config.turnDetector) {
    logLine(
      'entry',
      'room asks for the turn detector but SEED_AGENTS_VOICE_TURN_DETECTOR is off in this worker; using VAD endpointing',
    )
  }

  const session = new voice.AgentSession({
    vad,
    stt: new deepgram.STT({model: config.deepgramModel, language: config.language, apiKey: config.deepgramApiKey}),
    llm: new SeedSessionLLM({client, room, onLog: (line) => console.log(`[${ts()}] ${line}`)}),
    tts: new cartesia.TTS({
      model: config.cartesiaModel,
      voice: config.cartesiaVoice || undefined,
      language: config.language,
      apiKey: config.cartesiaApiKey,
    }),
    turnHandling: {
      // Without a local model the session would build a LiveKit Cloud inference detector, which a
      // self-hosted server cannot serve; VAD end-of-speech + endpointing delay is the fallback.
      turnDetection: turnDetector ?? 'vad',
      // `mode` left unset would try LiveKit Cloud's adaptive detector first (needs a cloud key).
      interruption: {enabled: true, mode: 'vad', minDuration: 500},
      endpointing: {minDelay: 500, maxDelay: 3000},
      // The Seed session is stateful: never run a speculative turn on an interim transcript.
      preemptiveGeneration: {enabled: false},
    },
    userAwayTimeout: null,
  })

  session.on(Events.MetricsCollected, (ev) => {
    const m = ev.metrics
    if (m.type === 'stt_metrics') {
      logLine('stt', `audio: ${fmtMs(m.audioDurationMs)}, duration: ${fmtMs(m.durationMs)}, streamed: ${m.streamed}`)
    } else if (m.type === 'llm_metrics') {
      logLine('llm', `TTFT: ${fmtMs(m.ttftMs)}, duration: ${fmtMs(m.durationMs)}${m.cancelled ? ' [CANCELLED]' : ''}`)
    } else if (m.type === 'tts_metrics') {
      logLine(
        'tts',
        `TTFB: ${fmtMs(m.ttfbMs)}, duration: ${fmtMs(m.durationMs)}, audio: ${fmtMs(m.audioDurationMs)}, ` +
          `chars: ${m.charactersCount}${m.cancelled ? ' [CANCELLED]' : ''}`,
      )
    } else if (m.type === 'eou_metrics') {
      logLine(
        'eou',
        `utterance delay: ${fmtMs(m.endOfUtteranceDelayMs)}, transcription delay: ${fmtMs(m.transcriptionDelayMs)}, ` +
          `turn completed delay: ${fmtMs(m.onUserTurnCompletedDelayMs)}`,
      )
    } else if (m.type === 'vad_metrics') {
      logLine(
        'vad',
        `idle: ${fmtMs(m.idleTimeMs)}, inferences: ${m.inferenceCount} (${fmtMs(m.inferenceDurationTotalMs)} total)`,
      )
    }
  })
  session.on(Events.AgentStateChanged, (ev) => logLine('agent', `${ev.oldState} → ${ev.newState}`))
  session.on(Events.UserStateChanged, (ev) => logLine('user', `${ev.oldState} → ${ev.newState}`))
  session.on(Events.UserInputTranscribed, (ev) => {
    logLine(ev.isFinal ? 'stt:final' : 'stt:interim', `"${ev.transcript}"`)
  })
  session.on(Events.ConversationItemAdded, (ev) => {
    const text = ev.item.type === 'message' ? ev.item.textContent ?? '' : ''
    const role = ev.item.type === 'message' ? ev.item.role : ev.item.type
    logLine('chat', `${role}: "${text.slice(0, 120)}${text.length > 120 ? '...' : ''}"`)
  })
  session.on(Events.SpeechCreated, (ev) => {
    logLine(
      'speech',
      `created (source: ${ev.source}, id: ${ev.speechHandle.id})${ev.userInitiated ? ' [user-initiated]' : ''}`,
    )
  })
  session.on(Events.Error, (ev) => {
    logError('error', `source: ${JSON.stringify(ev.source)}, error:`, ev.error)
  })
  session.on(Events.Close, (ev) => {
    logLine('session', `closed: ${ev.reason}`)
    logLine('usage', JSON.stringify(session.usage.modelUsage))
    // A session that died (unrecoverable STT/TTS error, user gone) must not leave the agent
    // sitting silently in the room: end the job so the shutdown callback runs and the room empties.
    if (ev.reason !== voice.CloseReason.JOB_SHUTDOWN) ctx.shutdown(`session closed: ${ev.reason}`)
  })

  const onParticipantConnected = (participant: {identity: string}) =>
    logLine('room', `participant joined: ${participant.identity}`)
  const onParticipantDisconnected = (participant: {identity: string}) =>
    logLine('room', `participant left: ${participant.identity}`)
  const onDisconnected = () => logLine('room', 'disconnected')
  ctx.room.on('participantConnected', onParticipantConnected)
  ctx.room.on('participantDisconnected', onParticipantDisconnected)
  ctx.room.on('disconnected', onDisconnected)

  ctx.addShutdownCallback(async () => {
    logLine('shutdown', 'closing session...')
    try {
      await session.close()
    } catch (err) {
      logError('shutdown', 'session close failed:', err)
    }
    // (botical closed the turn detector's ONNX session here; in 1.9.0 the model lives in the shared
    // inference executor process and the job holds nothing to release.)
    ctx.room.off('participantConnected', onParticipantConnected)
    ctx.room.off('participantDisconnected', onParticipantDisconnected)
    ctx.room.off('disconnected', onDisconnected)
    try {
      await client.leave(room)
      logLine('shutdown', `left room ${room}`)
    } catch (err) {
      logError('shutdown', `leave ${room} failed:`, err)
    }
    logLine('shutdown', `done (${fmtMem()})`)
  })

  logLine('entry', `starting agent session (${fmtMem()})`)
  await session.start({agent: new voice.Agent({instructions: INSTRUCTIONS}), room: ctx.room})
  logLine('entry', 'agent session started, waiting for user')
}

export default defineAgent<{vad?: VAD}>({
  prewarm: async (proc) => {
    logLine('prewarm', 'loading Silero VAD model...')
    proc.userData.vad = await silero.VAD.load()
    logLine('prewarm', `VAD model loaded, worker ready (pid ${proc.pid})`)
  },
  entry: runJob,
})

/**
 * Bun on Linux can return identical os.cpus() times across samples, producing NaN. A NaN load
 * breaks the LiveKit server's affinity calculation (1-NaN=NaN) and job requests are silently
 * dropped, so fall back to 0 when the sample is not finite.
 */
async function cpuLoad(): Promise<number> {
  const before = os.cpus()
  await Bun.sleep(2500)
  const after = os.cpus()
  let idle = 0
  let total = 0
  for (let i = 0; i < before.length; i++) {
    const t1 = before[i]?.times
    const t2 = after[i]?.times
    if (!t1 || !t2) continue
    idle += t2.idle - t1.idle
    total += Object.values(t2).reduce((a, b) => a + b, 0) - Object.values(t1).reduce((a, b) => a + b, 0)
  }
  const load = +(1 - idle / total).toFixed(2)
  return Number.isFinite(load) ? load : 0
}

cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,
    agentName: AGENT_NAME,
    wsURL: env.livekitUrl,
    apiKey: env.apiKey,
    apiSecret: env.apiSecret,
    loadFunc: cpuLoad,
  }),
)
