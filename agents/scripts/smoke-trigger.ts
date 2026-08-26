/**
 * Real-daemon smoke test for the comment-mention trigger fix.
 *
 * Boots the actual Agents daemon as a child process (the same `main.ts` the deployment image runs),
 * points its activity monitor at a local stand-in for hyper.media's `/api/ListEvents`, then drives the
 * full production path over the wire: signed CBOR API to create an agent + user-mention trigger, the
 * daemon's own monitor polling the feed, matching, and firing a session — observed through the signed
 * `GetAgentTrigger` action (the sessions it fired) and `ListSessions`.
 *
 * The feed serves ONLY the comment-sourced `citation` event (the sibling that arrives first; the
 * `comment` event is the one the staleness watermark was dropping). Before the fix the daemon
 * suppressed comment-sourced citations, so this would NEVER fire and the script times out. After the
 * fix the citation fires exactly one session — and re-serving it must not create a second.
 *
 * Run: `bun scripts/smoke-trigger.ts` (wired as `bun run test:trigger`).
 */
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import {serialize} from 'superjson'
import * as blobs from '@shm/shared/blobs'
import * as apisvc from '../src/api-service'
import * as cbor from '../src/cbor'

const MENTIONED_ACCOUNT = 'z6MknRGBsPMcrn5nAXWHmR4RjNuVTRK5a2rthFy188et7LKs'
const COMMENT_AUTHOR = 'z6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4'
const COMMENT_CID = 'bafy2bzaceca7qqno4qw7rxa3mblizsb266i2ryt6lojpxnocrfqn7yfy7m6ww'

const repoDir = path.resolve(import.meta.dirname, '..')
const dataDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-trigger-data-'))
const agentPort = 41_500 + Math.floor(Math.random() * 1_000)

/** Mutable feed the daemon polls; starts empty so the monitor can baseline its watermark. */
let feed: {events: unknown[]; nextPageToken: string} = {events: [], nextPageToken: ''}

const hmServer = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/api/ListEvents') return Response.json(serialize(feed))
    return new Response('not found', {status: 404})
  },
})
const hmBase = `http://127.0.0.1:${hmServer.port}`

const account = blobs.generateNobleKeyPair()
const apiBase = `http://127.0.0.1:${agentPort}`

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
    SEED_AGENTS_HM_SERVER_URL: hmBase,
    SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS: '300',
  },
})

try {
  await waitForHealth(agentPort)

  // Build the agent + user-mention trigger through the signed CBOR API, exactly as a client would.
  await action({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}})
  const created = await action({
    _: 'CreateAgent',
    definition: {name: 'Teal Scribe', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
  })
  if (created._ !== 'CreateAgentResponse') throw new Error(`unexpected CreateAgent response: ${created._}`)
  const createdTrigger = await action({
    _: 'CreateAgentTrigger',
    agentId: String(created.agentId),
    trigger: {
      name: 'Mentions of Teal Scribe',
      prompt: 'Respond to the mention.',
      source: {type: 'user-mention', mentionedAccounts: [MENTIONED_ACCOUNT]},
    },
  })
  if (createdTrigger._ !== 'CreateAgentTriggerResponse') {
    throw new Error(`unexpected CreateAgentTrigger response: ${createdTrigger._}`)
  }
  const triggerId = String((createdTrigger.trigger as {id: string}).id)

  // Serve only the citation twin of the mention (fresh). The daemon must fire on it.
  feed = {events: [citationEvent(COMMENT_CID, Date.now())], nextPageToken: ''}

  const fired = await waitFor(async () => {
    const overview = await status(triggerId)
    return overview.firings >= 1 ? overview : null
  }, 12_000)

  assert(fired.firings === 1, `expected exactly 1 firing, got ${fired.firings}`)
  assert(fired.sessions === 1, `expected exactly 1 session, got ${fired.sessions}`)

  // Keep serving the same citation for several more polls; it must not create a second firing/session.
  await Bun.sleep(1_500)
  const after = await status(triggerId)
  assert(after.firings === 1, `citation re-fired: ${after.firings} firings`)
  assert(after.sessions === 1, `extra sessions appeared: ${after.sessions}`)

  console.log(`Trigger smoke test passed: comment-sourced citation fired exactly one session on the real daemon.`)
} finally {
  server.kill('SIGTERM')
  await Promise.race([server.exited, Bun.sleep(2_000).then(() => server.kill('SIGKILL'))])
  await hmServer.stop(true)
  const [stdout, stderr] = await Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()])
  if (process.exitCode && stdout.trim()) console.log('[daemon stdout]\n' + stdout.trim())
  if (process.exitCode && stderr.trim()) console.error('[daemon stderr]\n' + stderr.trim())
  await rm(dataDir, {recursive: true, force: true})
}

/** A resolved comment-sourced `citation` event that mentions {@link MENTIONED_ACCOUNT}. */
function citationEvent(cid: string, eventAtMs: number) {
  return {
    id: cid,
    type: 'citation',
    citationType: 'c',
    feedEventId: `mention-${cid}--hm://${MENTIONED_ACCOUNT}/:profile`,
    eventAtMs,
    time: new Date(eventAtMs).toISOString(),
    source: {id: {uid: COMMENT_AUTHOR, id: `hm://${COMMENT_AUTHOR}`, path: []}},
    target: {id: {uid: MENTIONED_ACCOUNT, id: `hm://${MENTIONED_ACCOUNT}/:profile`, path: [':profile']}},
  }
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

type StatusOverview = {firings: number; sessions: number}

/** Firings (sessions started by the trigger) and total sessions on the account, via the signed API. */
async function status(triggerId: string): Promise<StatusOverview> {
  const trigger = await action({_: 'GetAgentTrigger', triggerId})
  if (trigger._ !== 'GetAgentTriggerResponse') throw new Error(`unexpected GetAgentTrigger response: ${trigger._}`)
  const sessions = await action({_: 'ListSessions'})
  if (sessions._ !== 'ListSessionsResponse') throw new Error(`unexpected ListSessions response: ${sessions._}`)
  return {
    firings: (trigger.sessions as unknown[]).length,
    sessions: (sessions.sessions as unknown[]).length,
  }
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await Bun.sleep(250)
  }
  throw new Error(`Condition not met within ${timeoutMs}ms (mention never fired — the bug this guards against)`)
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/agents/api/health`)
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
