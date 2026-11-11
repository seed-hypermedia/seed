/**
 * Smoke test for the production bundle (`bun run build`): boots `dist/main.js` the way the
 * deployment image does and drives one model turn through it over the signed API, against a local
 * stand-in for an OpenAI-compatible provider. Health alone proves the bundle starts; the turn
 * proves the parts that only load when a model is called — the provider adapter, which is a lazy
 * chunk, and the session's durable store — made it into the bundle and work from it.
 *
 * Run: `bun scripts/smoke-build.ts` (wired as `bun run test:build`).
 */
import {Database} from 'bun:sqlite'
import {mkdtemp, cp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import * as blobs from '@shm/shared/blobs'
import * as apisvc from '../src/api-service'
import * as cbor from '../src/cbor'

const repoDir = path.resolve(import.meta.dirname, '..')
const appDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-app-'))
const dataDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-data-'))
const port = 41_000 + Math.floor(Math.random() * 1_000)
const account = blobs.generateNobleKeyPair()

/** Stand-in provider: answers every chat completion with one streamed sentence. */
const provider = Bun.serve({
  port: 0,
  fetch(req) {
    if (!new URL(req.url).pathname.endsWith('/chat/completions')) return new Response('not found', {status: 404})
    const chunks = [
      {id: 'smoke', choices: [{index: 0, delta: {role: 'assistant', content: 'Bundled and answering.'}}]},
      {
        id: 'smoke',
        choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 3, completion_tokens: 3, total_tokens: 6},
      },
    ]
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: {'content-type': 'text/event-stream'},
    })
  },
})

try {
  await cp(path.join(repoDir, 'dist'), appDir, {recursive: true})
  await cp(path.join(repoDir, 'package.json'), path.join(appDir, 'package.json'))

  const server = Bun.spawn(['bun', 'run', '--no-install', 'main.js'], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SEED_AGENTS_DB_PATH: path.join(dataDir, 'agents.sqlite'),
      SEED_AGENTS_DATA_DIR: dataDir,
      SEED_AGENTS_HTTP_HOSTNAME: '127.0.0.1',
      SEED_AGENTS_HTTP_PORT: String(port),
    },
  })

  try {
    await waitForHealth(port)

    await action({
      _: 'SetModelProvider',
      name: 'local',
      provider: {type: 'custom', baseUrl: `http://127.0.0.1:${provider.port}/v1`},
    })
    const agent = await action({
      _: 'CreateAgent',
      definition: {name: 'Smoke', systemPrompt: 'ok', modelProvider: 'local', model: 'smoke-model'},
    })
    const session = await action({_: 'CreateSession', agentId: String(agent.agentId)})
    const sessionId = String(session.sessionId)
    const turn = await action({_: 'MessageSession', sessionId, content: [{type: 'text', text: 'Are you there?'}]})
    const fetched = await action({_: 'GetSession', sessionId})
    const events = fetched.events as {id: string; event: {type?: string; role?: string; content?: string}}[]
    const answer = events.find((event) => event.id === turn.assistantEventId)?.event
    if (answer?.role !== 'assistant' || answer.content !== 'Bundled and answering.') {
      throw new Error(`Bundled server did not answer the turn: ${JSON.stringify(events.map((event) => event.event))}`)
    }
    const database = new Database(path.join(dataDir, 'agents.sqlite'), {readonly: true})
    const stored = database
      .query<{n: number}, [string]>(`SELECT COUNT(*) AS n FROM session_durable_files WHERE session_id = ?`)
      .get(sessionId)
    database.close()
    if (!stored?.n) throw new Error('Bundled server left no durable store for the session')
    console.log(`Built agents server smoke test passed on port ${port}: health, one model turn, durable store`)
  } finally {
    server.kill('SIGTERM')
    await Promise.race([server.exited, Bun.sleep(2_000).then(() => server.kill('SIGKILL'))])

    const [stdout, stderr] = await Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()])
    if (stdout.trim()) console.log(stdout.trim())
    if (stderr.trim()) console.error(stderr.trim())
  }
} finally {
  await provider.stop(true)
  await Promise.all([rm(appDir, {recursive: true, force: true}), rm(dataDir, {recursive: true, force: true})])
}

/** Sends one signed action to the bundled server and returns its decoded response. */
async function action(
  unsigned: Parameters<typeof apisvc.createSignedEnvelope>[1]['action'],
): Promise<{_: string} & Record<string, unknown>> {
  const envelope = await apisvc.createSignedEnvelope(account, {action: unsigned})
  const response = await fetch(`http://127.0.0.1:${port}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor'},
    body: cbor.encode(envelope) as BodyInit,
  })
  const decoded = cbor.decode<{_: string} & Record<string, unknown>>(new Uint8Array(await response.arrayBuffer()))
  if (decoded._ === 'Error') throw new Error(`API error for ${unsigned._}: ${decoded.message}`)
  return decoded
}

async function waitForHealth(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/agents/api/health`
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.json()
        if (body?.status === 'ok') return
        throw new Error(`Unexpected health body: ${JSON.stringify(body)}`)
      }
      lastError = new Error(`Health returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(250)
  }
  throw new Error(
    `Built agents server did not become healthy: ${lastError instanceof Error ? lastError.message : lastError}`,
  )
}
