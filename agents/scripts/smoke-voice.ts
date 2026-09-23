/**
 * Real-process smoke test for agent voice sessions (docs/voice.md).
 *
 * Boots `livekit-server --dev` (unless something already listens on :7880), then the actual Agents
 * daemon from source with voice on in `child` worker mode — so main.ts spawns the LiveKit worker
 * itself — and drives the production path over the wire:
 *
 *   1. signed CBOR API: provider + agent + session, GetVoiceSettings, SetVoiceSettings (per-account
 *      Deepgram key), CreateVoiceSession (token, room, dispatch);
 *   2. the worker's loopback routes with the internal token: room-config must hand back the
 *      account's key, `leave` must be idempotent, `turn` must stream NDJSON and end with `done` or
 *      `error` (the smoke provider has no model key, so the run fails fast — the stream contract is
 *      what is checked, not the reply);
 *   3. the worker child: it must register with LiveKit, receive the dispatch, fetch room-config,
 *      start the pipeline, and — the speech keys being placeholders — fail its STT handshake
 *      cleanly and leave the room (observed in the daemon's inherited stdout).
 *
 * Needs `livekit-server` on PATH (`brew install livekit`). No speech API keys are required.
 * Run: `bun scripts/smoke-voice.ts` (wired as `bun run test:voice`).
 */
import {mkdtemp, rm} from 'node:fs/promises'
import {createServer as createNetServer} from 'node:net'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import * as blobs from '@shm/shared/blobs'
import * as apisvc from '../src/api-service'
import * as cbor from '../src/cbor'

const LIVEKIT_PORT = 7880
const INTERNAL_TOKEN = 'smoke-voice-token'
const ACCOUNT_DEEPGRAM_KEY = 'dg-smoke-account-key'

const repoDir = path.resolve(import.meta.dirname, '..')
const dataDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-voice-data-'))
const agentPort = 42_500 + Math.floor(Math.random() * 1_000)
const apiBase = `http://127.0.0.1:${agentPort}`
const account = blobs.generateNobleKeyPair()

let livekit: Bun.Subprocess | undefined
if (await isPortFree(LIVEKIT_PORT)) {
  const binary = Bun.which('livekit-server')
  if (!binary) throw new Error('livekit-server is not on PATH (brew install livekit)')
  livekit = Bun.spawn([binary, '--dev'], {stdout: 'ignore', stderr: 'ignore'})
  await waitFor(async () => (!(await isPortFree(LIVEKIT_PORT)) ? true : null), 15_000, 'LiveKit did not start')
  console.log(`[smoke] started livekit-server --dev (pid ${livekit.pid})`)
} else {
  console.log(`[smoke] using the LiveKit server already on :${LIVEKIT_PORT}`)
}

/** Everything the daemon and its worker child print, for the assertions below. */
let daemonLog = ''
const server = Bun.spawn(['bun', 'run', 'src/main.ts'], {
  cwd: repoDir,
  stdout: 'pipe',
  stderr: 'pipe',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    SEED_AGENTS_DB_PATH: path.join(dataDir, 'agents.sqlite'),
    SEED_AGENTS_DATA_DIR: dataDir,
    SEED_AGENTS_HTTP_HOSTNAME: '127.0.0.1',
    SEED_AGENTS_HTTP_PORT: String(agentPort),
    SEED_AGENTS_EXEC_BACKEND: '',
    SEED_AGENTS_SESSION_TITLE_GENERATION: 'false',
    SEED_AGENTS_VOICE_ENABLED: '1',
    SEED_AGENTS_VOICE_WORKER: 'child',
    SEED_AGENTS_VOICE_INTERNAL_TOKEN: INTERNAL_TOKEN,
    SEED_AGENTS_VOICE_TURN_DETECTOR: '0',
    SEED_AGENTS_DEEPGRAM_API_KEY: 'your-deepgram-api-key',
    SEED_AGENTS_CARTESIA_API_KEY: 'your-cartesia-api-key',
  },
})
void pump(server.stdout, (chunk) => (daemonLog += chunk))
void pump(server.stderr, (chunk) => (daemonLog += chunk))

try {
  await waitForHealth()
  const health = (await (await fetch(`${apiBase}/agents/api/health`)).json()) as {voice?: boolean}
  assert(health.voice === true, `health.voice should be true, got ${JSON.stringify(health.voice)}`)
  console.log('[smoke] daemon healthy, voice on')

  // --- 1. signed API ---------------------------------------------------------------------------
  await action({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}})
  const agent = await action({
    _: 'CreateAgent',
    definition: {name: 'Voice smoke', systemPrompt: 'Talk.', modelProvider: 'openai', model: 'gpt-test', tools: []},
  })
  const session = await action({_: 'CreateSession', agentId: agent.agentId as string})
  const sessionId = session.sessionId as string

  const before = await action({_: 'GetVoiceSettings'})
  assert(before.available === true, 'GetVoiceSettings.available should be true')
  assert(before.deepgramApiKey === 'none', `deepgram key source should start as none, got ${before.deepgramApiKey}`)
  const set = await action({_: 'SetVoiceSettings', deepgramApiKey: ACCOUNT_DEEPGRAM_KEY})
  assert(set.deepgramApiKey === 'account', `deepgram key source should be account after set, got ${set.deepgramApiKey}`)
  assert(set.cartesiaApiKey === 'none', `cartesia key source should stay none, got ${set.cartesiaApiKey}`)
  console.log('[smoke] voice settings: none → account')

  // In production the worker registers at boot, long before any mic click; here it is racing us,
  // and LiveKit only hands an explicit dispatch to a worker that is already registered.
  await waitFor(
    async () => (daemonLog.includes('registered worker') ? true : null),
    60_000,
    'worker child never registered with LiveKit',
  )
  console.log('[smoke] worker child registered with LiveKit')

  const voiceSession = await action({_: 'CreateVoiceSession', sessionId})
  assert(voiceSession._ === 'CreateVoiceSessionResponse', `unexpected ${voiceSession._}`)
  const room = voiceSession.room as string
  assert(room === `seed-voice-${sessionId}`, `unexpected room ${room}`)
  assert(typeof voiceSession.token === 'string' && (voiceSession.token as string).split('.').length === 3, 'no JWT')
  assert((voiceSession.url as string).startsWith('ws://'), `unexpected url ${voiceSession.url}`)
  console.log(`[smoke] CreateVoiceSession → room ${room}, identity ${voiceSession.identity}`)

  // --- 2. loopback routes -----------------------------------------------------------------------
  const unauthorized = await fetch(`${apiBase}/agents/api/voice/room-config`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({room}),
  })
  assert(unauthorized.status === 401, `room-config without token should be 401, got ${unauthorized.status}`)
  const roomConfig = (await internal('room-config', {room})) as Record<string, unknown>
  assert(roomConfig.sessionId === sessionId, 'room-config sessionId mismatch')
  assert(roomConfig.deepgramApiKey === ACCOUNT_DEEPGRAM_KEY, 'room-config should carry the account Deepgram key')
  assert(roomConfig.cartesiaApiKey === 'your-cartesia-api-key', 'room-config should fall back to the server key')
  console.log('[smoke] room-config carries the per-account key and the server placeholder')

  const turnRes = await fetch(`${apiBase}/agents/api/voice/turn`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${INTERNAL_TOKEN}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({room, text: 'hello from the smoke test'}),
  })
  assert(turnRes.status === 200, `turn should be 200, got ${turnRes.status}`)
  assert(turnRes.headers.get('content-type')?.includes('ndjson'), 'turn should stream NDJSON')
  const lines = (await turnRes.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const last = lines.at(-1)
  assert(
    last && (last.done === true || typeof last.error === 'string'),
    `turn stream must end with done/error: ${JSON.stringify(lines)}`,
  )
  console.log(
    `[smoke] turn streamed ${lines.length} line(s), ended with ${last.done ? 'done' : `error: ${last.error}`}`,
  )
  const events = await action({_: 'GetSession', sessionId})
  const userMessages = (events.events as Array<{event: {type: string; role?: string; content?: string}}>).filter(
    (e) => e.event.type === 'message' && e.event.role === 'user',
  )
  assert(
    userMessages.some((e) => e.event.content?.includes('hello from the smoke test')),
    'utterance not in session log',
  )
  console.log('[smoke] the utterance landed in the session transcript as a user message')

  // --- 3. the worker child ----------------------------------------------------------------------
  await waitFor(
    async () => (daemonLog.includes(`connected to room ${room}`) ? true : null),
    60_000,
    'worker never joined the room (dispatch or registration failed)',
  )
  console.log('[smoke] worker child joined the room')
  await waitFor(
    async () => (daemonLog.includes('agent session started') ? true : null),
    30_000,
    'worker never started its pipeline (room-config failed?)',
  )
  console.log('[smoke] worker built the pipeline from room-config')
  await waitFor(
    async () => (daemonLog.includes(`left room ${room}`) ? true : null),
    60_000,
    'worker did not leave the room after the placeholder-key STT failure',
  )
  console.log('[smoke] worker failed STT on the placeholder key, closed the session, and left the room')
  const gone = await fetch(`${apiBase}/agents/api/voice/room-config`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${INTERNAL_TOKEN}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({room}),
  })
  assert(gone.status === 403, `room should be forgotten after leave, got ${gone.status}`)
  assert(!daemonLog.includes(ACCOUNT_DEEPGRAM_KEY), 'the account key leaked into the logs')
  console.log('[smoke] room forgotten after leave; no key material in the logs')
  console.log('Voice smoke test passed')
} catch (error) {
  console.error('[smoke] FAILED:', error instanceof Error ? error.message : error)
  console.error('----- daemon + worker output -----')
  console.error(daemonLog.slice(-8_000))
  process.exitCode = 1
} finally {
  server.kill('SIGTERM')
  await Promise.race([server.exited, Bun.sleep(8_000).then(() => server.kill('SIGKILL'))])
  if (livekit) {
    livekit.kill('SIGTERM')
    await Promise.race([livekit.exited, Bun.sleep(3_000).then(() => livekit?.kill('SIGKILL'))])
  }
  await rm(dataDir, {recursive: true, force: true})
}

async function action(
  unsigned: Parameters<typeof apisvc.createSignedEnvelope>[1]['action'],
): Promise<{_: string} & Record<string, unknown>> {
  const envelope = await apisvc.createSignedEnvelope(account, {action: unsigned})
  const res = await fetch(`${apiBase}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor'},
    body: cbor.encode(envelope) as BodyInit,
  })
  const decoded = cbor.decode<{_: string} & Record<string, unknown>>(new Uint8Array(await res.arrayBuffer()))
  if (decoded._ === 'Error') throw new Error(`API error for ${unsigned._}: ${decoded.message}`)
  return decoded
}

async function internal(route: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${apiBase}/agents/api/voice/${route}`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${INTERNAL_TOKEN}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`voice ${route} failed: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function pump(stream: ReadableStream<Uint8Array>, onChunk: (text: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  for await (const chunk of stream) onChunk(decoder.decode(chunk, {stream: true}))
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number, failure: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await Bun.sleep(250)
  }
  throw new Error(`${failure} (within ${timeoutMs}ms)`)
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}/agents/api/health`)
      if (response.ok && (await response.json())?.status === 'ok') return
    } catch {
      // not up yet
    }
    await Bun.sleep(250)
  }
  throw new Error('Agents daemon did not become healthy')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
