/**
 * Real-daemon smoke test for the effect outbox and the disk floor (hypermedia/agent/effect-outbox.md).
 *
 * Boots the actual Agents daemon as a child process on a real SQLite file, points its model provider
 * at a local OpenAI-compatible stand-in, and drives the production path over the wire with the signed
 * CBOR API. Then it does to the daemon what the outbox exists for:
 *
 * 1. (optional) boots on a copy of a real database named by `SEED_AGENTS_SMOKE_REAL_DB`, so the
 *    migration runs against real rows and the boot sweep sees real history;
 * 2. a turn whose tool writes a memory file leaves a `succeeded` receipt;
 * 3. `kill -9` while a memory download is in flight, then a restart: the download is not repeated,
 *    the call is answered as interrupted naming the effect, and the turn finishes;
 * 4. (macOS) the database on a 32 MiB RAM disk with a free-space floor: filling the disk pauses
 *    dispatch (visible in /api/health), a message waits in the queue, freeing the disk runs it;
 * 5. (macOS) the floor off and the disk filled to ENOSPC in the middle of a turn: the run fails
 *    instead of finishing as a success the log does not hold, and after the disk is freed and the
 *    daemon restarted the session converges to one well-formed transcript.
 *
 * Run: `bun scripts/smoke-outbox.ts` (wired as `bun run test:outbox`). Needs nothing but bun; the
 * RAM-disk scenarios run only on macOS and are skipped elsewhere.
 */
import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import {serialize} from 'superjson'
import * as blobs from '@shm/shared/blobs'
import * as apisvc from '../src/api-service'
import * as cbor from '../src/cbor'

const repoDir = path.resolve(import.meta.dirname, '..')
const scratch = await mkdtemp(path.join(tmpdir(), 'seed-agents-outbox-smoke-'))
const account = blobs.generateNobleKeyPair()
const isMac = process.platform === 'darwin'
let failures = 0

// ---------------------------------------------------------------------------------------------
// Stand-ins: an OpenAI-compatible model, a file host for `write … fromUrl`, and an HM server.
// ---------------------------------------------------------------------------------------------

type ChatMessage = {role: string; content?: unknown; tool_calls?: unknown}
/** What the model answers the next turn with: a tool call, then text once the tool result is in. */
let modelPlan: {tool: string; args: unknown; text: string} | {text: string} = {text: 'Hello.'}
/** A gate the model request waits on before answering (scenario 5 fills the disk behind it). */
let beforeModelAnswer: (() => Promise<void>) | undefined
let modelRequests = 0

const model = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname.endsWith('/models')) return Response.json({data: [{id: 'fake'}]})
    if (!url.pathname.endsWith('/chat/completions')) return new Response('not found', {status: 404})
    modelRequests += 1
    const body = (await req.json()) as {messages: ChatMessage[]}
    if (beforeModelAnswer) {
      const gate = beforeModelAnswer
      beforeModelAnswer = undefined
      await gate()
    }
    // One tool call per conversation, then text. (A resumed turn ends its request with a
    // `<turn_resumed>` user message after the tool result, so "is the last message a tool result"
    // would call the tool again and defeat the restart scenario.)
    const toolAlreadyCalled = body.messages.some((message) => message.role === 'tool')
    if ('tool' in modelPlan && !toolAlreadyCalled) {
      return sse([
        {
          id: `chat-${modelRequests}`,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'On it.',
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${modelRequests}`,
                    type: 'function',
                    function: {name: modelPlan.tool, arguments: JSON.stringify(modelPlan.args)},
                  },
                ],
              },
            },
          ],
        },
        {id: `chat-${modelRequests}`, choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}], usage: usage()},
      ])
    }
    return sse([
      {id: `chat-${modelRequests}`, choices: [{index: 0, delta: {role: 'assistant', content: modelPlan.text}}]},
      {id: `chat-${modelRequests}`, choices: [{index: 0, delta: {}, finish_reason: 'stop'}], usage: usage()},
    ])
  },
})

let fileHostHangs = false
let fileDownloads = 0
/** Downloads left hanging on purpose; released at shutdown so the server can stop. */
const hungDownloads: Array<(response: Response) => void> = []
const fileHost = Bun.serve({
  port: 0,
  fetch() {
    fileDownloads += 1
    if (fileHostHangs) return new Promise<Response>((resolve) => hungDownloads.push(resolve))
    return new Response('notes from the file host', {headers: {'content-type': 'text/plain'}})
  },
})

const hmStub = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/api/ListEvents') return Response.json(serialize({events: [], nextPageToken: ''}))
    return new Response('not found', {status: 404})
  },
})

// ---------------------------------------------------------------------------------------------
// The daemon under test.
// ---------------------------------------------------------------------------------------------

type Daemon = {
  port: number
  dbPath: string
  proc: ReturnType<typeof Bun.spawn>
  /** Everything the daemon printed so far. */
  readonly output: () => string
  stop: (signal?: 'SIGTERM' | 'SIGKILL') => Promise<void>
}

async function startDaemon(options: {dbPath: string; dataDir: string; env?: Record<string, string>}): Promise<Daemon> {
  const port = 42_500 + Math.floor(Math.random() * 1_000)
  const chunks: string[] = []
  const proc = Bun.spawn(['bun', 'run', 'src/main.ts'], {
    cwd: repoDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SEED_AGENTS_DB_PATH: options.dbPath,
      SEED_AGENTS_DATA_DIR: options.dataDir,
      SEED_AGENTS_HTTP_HOSTNAME: '127.0.0.1',
      SEED_AGENTS_HTTP_PORT: String(port),
      SEED_AGENTS_HM_SERVER_URL: `http://127.0.0.1:${hmStub.port}`,
      SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS: '60000',
      SEED_AGENTS_SESSION_TITLE_GENERATION: 'false',
      SEED_AGENTS_EXEC_BACKEND: 'off',
      ...options.env,
    },
  })
  const drain = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return
    const decoder = new TextDecoder()
    for await (const chunk of stream) chunks.push(decoder.decode(chunk))
  }
  void drain(proc.stdout as ReadableStream<Uint8Array>)
  void drain(proc.stderr as ReadableStream<Uint8Array>)
  const daemon: Daemon = {
    port,
    dbPath: options.dbPath,
    proc,
    output: () => chunks.join(''),
    stop: async (signal = 'SIGTERM') => {
      proc.kill(signal)
      await Promise.race([proc.exited, Bun.sleep(3_000).then(() => proc.kill('SIGKILL'))])
      await proc.exited
      console.log(`   [smoke] daemon on :${port} stopped (${signal})`)
    },
  }
  await waitForHealth(daemon)
  return daemon
}

/** The daemon the current scenario drives. */
function current(): Daemon {
  if (!daemon) throw new Error('no daemon is running')
  return daemon
}

async function health(daemon: Daemon): Promise<Record<string, any>> {
  const response = await fetch(`http://127.0.0.1:${daemon.port}/agents/api/health`)
  return (await response.json()) as Record<string, any>
}

async function waitForHealth(daemon: Daemon): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (daemon.proc.exitCode !== null) throw new Error(`daemon exited early:\n${daemon.output()}`)
    try {
      if ((await health(daemon)).status === 'ok') return
    } catch {
      // not up yet
    }
    await Bun.sleep(250)
  }
  throw new Error(`daemon did not become healthy:\n${daemon.output()}`)
}

async function action(
  daemon: Daemon,
  unsigned: Parameters<typeof apisvc.createSignedEnvelope>[1]['action'],
): Promise<{_: string} & Record<string, any>> {
  const envelope = await apisvc.createSignedEnvelope(account, {action: unsigned})
  const res = await fetch(`http://127.0.0.1:${daemon.port}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor'},
    body: cbor.encode(envelope) as BodyInit,
    // A turn that never answers must fail the scenario, not hang the script.
    signal: AbortSignal.timeout(90_000),
  })
  return cbor.decode<{_: string} & Record<string, any>>(new Uint8Array(await res.arrayBuffer()))
}

/** Reads the daemon's database from this process, as an operator with sqlite3 would. */
function query<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  const db = new Database(dbPath, {readonly: true, strict: true})
  try {
    return db.query<T, any[]>(sql).all(...(params as any[]))
  } finally {
    db.close()
  }
}

type LogEvent = {type: string; role?: string; content?: string; error?: string; output?: unknown; message?: string}

async function sessionEvents(daemon: Daemon, sessionId: string): Promise<LogEvent[]> {
  const response = await action(daemon, {_: 'GetSession', sessionId})
  if (response._ !== 'GetSessionResponse') throw new Error(`GetSession: ${response.message ?? response._}`)
  return (response.events as Array<{event: LogEvent}>).map((event) => event.event)
}

async function setUpAgent(daemon: Daemon): Promise<string> {
  const provider = await action(daemon, {
    _: 'SetModelProvider',
    name: 'fake',
    provider: {type: 'custom', baseUrl: `http://127.0.0.1:${model.port}/v1`},
  })
  assert(provider._ !== 'Error', `SetModelProvider: ${provider.message}`)
  const created = await action(daemon, {
    _: 'CreateAgent',
    definition: {
      name: 'Outbox Smoke',
      systemPrompt: 'Do what the user says. Be terse.',
      modelProvider: 'fake',
      model: 'fake',
    },
  })
  assert(created._ === 'CreateAgentResponse', `CreateAgent: ${created.message}`)
  return String(created.agentId)
}

async function newSession(daemon: Daemon, agentId: string): Promise<string> {
  const session = await action(daemon, {_: 'CreateSession', agentId})
  assert(session._ === 'CreateSessionResponse', `CreateSession: ${session.message}`)
  return String(session.sessionId)
}

async function say(daemon: Daemon, sessionId: string, text: string): Promise<{_: string} & Record<string, any>> {
  return action(daemon, {_: 'MessageSession', sessionId, content: [{type: 'text', text}]})
}

async function waitForRun(daemon: Daemon, sessionId: string, timeoutMs = 20_000): Promise<string> {
  return waitFor(async () => {
    const rows = query<{status: string}>(
      daemon.dbPath,
      `SELECT status FROM runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
      [sessionId],
    )
    const status = rows[0]?.status
    return status && !['queued', 'claimed', 'running', 'waiting'].includes(status) ? status : null
  }, timeoutMs)
}

/** A transcript is well-formed when every agent tool call has exactly one result. */
function assertWellFormed(events: LogEvent[], label: string): void {
  const calls = events.filter((event) => event.type === 'tool_call') as Array<LogEvent & {id?: string}>
  const results = events.filter((event) => event.type === 'tool_result') as Array<LogEvent & {toolCallId?: string}>
  for (const call of calls) {
    const matching = results.filter((result) => result.toolCallId === call.id)
    assert(matching.length === 1, `${label}: tool call ${call.id} has ${matching.length} results`)
  }
  assert(
    results.every((result) => calls.some((call) => call.id === result.toolCallId)),
    `${label}: orphan tool_result`,
  )
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

/** `SEED_AGENTS_SMOKE_ONLY=restart,floor` runs only the scenarios whose names contain a word. */
const only = (process.env.SEED_AGENTS_SMOKE_ONLY ?? '')
  .split(',')
  .map((word) => word.trim())
  .filter(Boolean)

async function scenario(name: string, run: () => Promise<void>): Promise<void> {
  if (only.length && !only.some((word) => name.includes(word))) {
    console.log(`\n== ${name}\n   skipped`)
    return
  }
  console.log(`\n== ${name}`)
  try {
    await run()
    console.log(`   ok`)
  } catch (error) {
    failures += 1
    process.exitCode = 1
    console.error(`   FAILED: ${error instanceof Error ? error.message : String(error)}`)
    const output = daemon?.output() ?? ''
    const relevant = output
      .split('\n')
      .filter((line) => /outbox|tool call|interrupted|receipt|sweep|dispatch/.test(line))
    if (relevant.length) console.error(`   [daemon lines about the outbox]\n${relevant.slice(-30).join('\n')}`)
    console.error(`   [daemon output tail]\n${output.split('\n').slice(-25).join('\n')}`)
    if (daemon) {
      try {
        const rows = query(daemon.dbPath, `SELECT tool_call_id, kind, status, error, lease_owner FROM effect_outbox`)
        console.error(`   [effect_outbox]\n${JSON.stringify(rows, null, 1)}`)
      } catch {
        // the database may be gone with the RAM disk
      }
      // The next scenario starts its own daemon; this one must not linger on the same files.
      if (daemon.proc.exitCode === null) await daemon.stop('SIGKILL').catch(() => {})
    }
  }
}

let daemon: Daemon | undefined

const realDb = process.env.SEED_AGENTS_SMOKE_REAL_DB
if (realDb) {
  await scenario(`migration 31 and boot sweep on a copy of ${realDb}`, async () => {
    const dataDir = path.join(scratch, 'real')
    fs.mkdirSync(path.join(dataDir, 'agents'), {recursive: true})
    const dbPath = path.join(dataDir, 'agents.sqlite')
    fs.copyFileSync(realDb, dbPath)
    // The copy must never touch the real agents' state directories.
    const db = new Database(dbPath, {strict: true})
    db.run(`UPDATE agents SET state_dir = ? || '/agents/' || id`, [dataDir])
    const before = db
      .query<{value: string}, []>(`SELECT value FROM server_config WHERE key = 'schema_migration_version'`)
      .get()
    const running = db
      .query<{n: number}, []>(`SELECT COUNT(*) AS n FROM runs WHERE status IN ('claimed', 'running')`)
      .get()
    db.close()
    console.log(`   schema version before: ${before?.value}; runs left claimed/running: ${running?.n}`)
    const daemon = await startDaemon({dbPath, dataDir})
    try {
      const version = query<{value: string}>(
        dbPath,
        `SELECT value FROM server_config WHERE key = 'schema_migration_version'`,
      )
      assert(version[0]?.value === '31', `schema version after boot is ${version[0]?.value}, expected 31`)
      const table = query<{name: string}>(
        dbPath,
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_outbox'`,
      )
      assert(table.length === 1, 'effect_outbox table missing after migration')
      const h = await health(daemon)
      assert(
        h.disk && typeof h.disk.freeBytes === 'number' && h.disk.ok === true,
        `health.disk unexpected: ${JSON.stringify(h.disk)}`,
      )
      assert(h.dispatch?.paused === false, `health.dispatch unexpected: ${JSON.stringify(h.dispatch)}`)
      const stillRunning = query<{n: number}>(
        dbPath,
        `SELECT COUNT(*) AS n FROM runs WHERE status IN ('claimed', 'running')`,
      )
      assert(stillRunning[0]?.n === 0, `boot sweep left ${stillRunning[0]?.n} runs claimed/running`)
      console.log(
        `   migrated ${query<{n: number}>(dbPath, `SELECT COUNT(*) AS n FROM sessions`)[0]
          ?.n} sessions; health.disk.freeBytes=${h.disk.freeBytes}`,
      )
    } finally {
      await daemon.stop()
    }
  })
}

const mainDataDir = path.join(scratch, 'main')
fs.mkdirSync(mainDataDir, {recursive: true})
const mainDb = path.join(mainDataDir, 'agents.sqlite')
daemon = await startDaemon({dbPath: mainDb, dataDir: mainDataDir})
let agentId = ''

await scenario('a memory write leaves a succeeded receipt and a well-formed transcript', async () => {
  agentId = await setUpAgent(current())
  const sessionId = await newSession(current(), agentId)
  modelPlan = {
    tool: 'write',
    args: {address: '~/memory/notes.md', content: 'hello from the smoke test'},
    text: 'Saved.',
  }
  const reply = await say(current(), sessionId, 'Save a note that says hello')
  assert(reply._ === 'MessageSessionResponse', `MessageSession: ${reply.message}`)
  const events = await sessionEvents(current(), sessionId)
  assertWellFormed(events, 'happy path')
  assert(events.at(-1)?.content === 'Saved.', `last event is not the answer: ${JSON.stringify(events.at(-1))}`)
  const rows = query<{kind: string; status: string; tool: string}>(
    mainDb,
    `SELECT kind, status, tool FROM effect_outbox WHERE session_id = ?`,
    [sessionId],
  )
  assert(
    rows.length === 1 && rows[0]?.status === 'succeeded' && rows[0]?.kind === 'memory-write',
    `outbox rows: ${JSON.stringify(rows)}`,
  )
  const notes = path.join(mainDataDir, 'agents', agentId, 'memory', 'notes.md')
  assert(fs.existsSync(notes), `memory file missing at ${notes}`)
})

await scenario('kill -9 mid-download, restart: not repeated, answered as interrupted naming the effect', async () => {
  const sessionId = await newSession(current(), agentId)
  fileHostHangs = true
  fileDownloads = 0
  modelPlan = {
    tool: 'write',
    args: {address: '~/memory/downloaded.txt', options: {fromUrl: `http://127.0.0.1:${fileHost.port}/notes.txt`}},
    text: 'The download was cut off; I did not retry it.',
  }
  const pending = say(current(), sessionId, 'Download the notes').catch(() => undefined)
  await waitFor(async () => {
    const rows = query<{status: string}>(mainDb, `SELECT status FROM effect_outbox WHERE session_id = ?`, [sessionId])
    return rows[0]?.status === 'running' ? rows[0] : null
  }, 15_000)
  assert(fileDownloads === 1, `expected the download to have started once, saw ${fileDownloads}`)
  await current().stop('SIGKILL')
  await pending
  fileHostHangs = false

  daemon = await startDaemon({dbPath: mainDb, dataDir: mainDataDir})
  assert(current().output().includes('boot sweep settled effects'), 'boot sweep did not report the running effect')
  const status = await waitForRun(current(), sessionId)
  assert(status === 'succeeded', `run ended ${status}`)
  assert(fileDownloads === 1, `the download ran again after the restart (${fileDownloads} requests)`)
  const row = query<{status: string; kind: string}>(
    mainDb,
    `SELECT status, kind FROM effect_outbox WHERE session_id = ?`,
    [sessionId],
  )[0]
  assert(row?.status === 'interrupted' && row.kind === 'memory-write', `outbox row: ${JSON.stringify(row)}`)
  const events = await sessionEvents(current(), sessionId)
  assertWellFormed(events, 'after restart')
  const result = events.find((event) => event.type === 'tool_result')
  assert(
    result?.error?.includes('while writing a memory file'),
    `tool result does not name the effect: ${JSON.stringify(result)}`,
  )
  assert(events.at(-1)?.content?.includes('did not retry'), `no final answer: ${JSON.stringify(events.at(-1))}`)
  assert(
    !fs.existsSync(path.join(mainDataDir, 'agents', agentId, 'memory', 'downloaded.txt')),
    'the file was written anyway',
  )
})

await current().stop()

const wantsRamDisk = !only.length || only.some((word) => 'disk floor ENOSPC mid-turn'.includes(word))
if (!isMac || !wantsRamDisk) {
  console.log(isMac ? '\n(RAM-disk scenarios not selected)' : '\n(skipping the RAM-disk scenarios: not macOS)')
} else {
  let device = ''
  const volume = '/Volumes/SeedOutboxSmoke'
  try {
    device =
      Bun.spawnSync(['hdiutil', 'attach', '-nomount', 'ram://65536']).stdout.toString().trim().split(/\s+/)[0] ?? ''
    assert(device.startsWith('/dev/'), `could not create a RAM disk: ${device}`)
    await Bun.sleep(500)
    const erased = Bun.spawnSync(['diskutil', 'eraseVolume', 'HFS+', 'SeedOutboxSmoke', device])
    assert(erased.exitCode === 0, `could not format the RAM disk: ${erased.stderr.toString()}`)
    const ramDataDir = path.join(volume, 'data')
    fs.mkdirSync(ramDataDir, {recursive: true})
    const ramDb = path.join(ramDataDir, 'agents.sqlite')
    const filler = path.join(volume, 'filler')

    await scenario(
      'disk floor: a full-ish disk pauses dispatch, a message waits, freeing the disk runs it',
      async () => {
        daemon = await startDaemon({dbPath: ramDb, dataDir: ramDataDir, env: {SEED_AGENTS_MIN_FREE_DISK_MIB: '8'}})
        agentId = await setUpAgent(current())
        const sessionId = await newSession(current(), agentId)
        let h = await health(current())
        assert(
          h.dispatch?.paused === false && h.disk?.ok === true,
          `unexpected health before fill: ${JSON.stringify(h)}`,
        )
        // Leave about 4 MiB free: under the 8 MiB floor, but with room to record a message.
        const free = Number(h.disk.freeBytes)
        fs.writeFileSync(filler, Buffer.alloc(Math.max(0, free - 4 * 1_048_576)))
        // The daemon reads free space at most once a second.
        await Bun.sleep(1_200)
        h = await health(current())
        assert(
          h.dispatch?.paused === true && String(h.dispatch.reason).includes('below the'),
          `dispatch not paused: ${JSON.stringify(h)}`,
        )
        modelPlan = {text: 'Answered once the disk had room.'}
        const reply = await say(current(), sessionId, 'Are you there?')
        assert(
          reply._ === 'MessageSessionResponse' && reply.assistantEventId === '',
          `message was not held: ${JSON.stringify(reply)}`,
        )
        const queued = query<{status: string}>(ramDb, `SELECT status FROM runs WHERE session_id = ?`, [sessionId])
        assert(queued[0]?.status === 'queued', `run status while paused: ${JSON.stringify(queued)}`)
        await Bun.sleep(1_500)
        assert(
          modelRequests === 0 ||
            query<{status: string}>(ramDb, `SELECT status FROM runs WHERE session_id = ?`, [sessionId])[0]?.status ===
              'queued',
          'the run started while dispatch was paused',
        )
        fs.rmSync(filler)
        const status = await waitForRun(current(), sessionId)
        assert(status === 'succeeded', `run ended ${status} after the disk was freed`)
        const events = await sessionEvents(current(), sessionId)
        assert(
          events.at(-1)?.content === 'Answered once the disk had room.',
          `no answer: ${JSON.stringify(events.at(-1))}`,
        )
        const output = current().output()
        assert(
          output.includes('dispatch paused') && output.includes('dispatch resumed'),
          'pause/resume were not logged',
        )
        await current().stop()
      },
    )

    await scenario(
      'floor off, ENOSPC mid-turn: the run fails, and after recovery the transcript is well-formed',
      async () => {
        daemon = await startDaemon({dbPath: ramDb, dataDir: ramDataDir, env: {SEED_AGENTS_MIN_FREE_DISK_MIB: '0'}})
        const sessionId = await newSession(current(), agentId)
        modelPlan = {text: 'An answer written onto a full disk.'}
        modelRequests = 0
        // The model answers only after the disk is full, so the user message is recorded and the
        // turn's own writes are the ones that fail.
        beforeModelAnswer = async () => {
          const fd = fs.openSync(filler, 'w')
          const chunk = Buffer.alloc(65_536)
          try {
            for (;;) fs.writeSync(fd, chunk)
          } catch {
            // ENOSPC: the disk is full.
          } finally {
            fs.closeSync(fd)
          }
        }
        const reply = await say(current(), sessionId, 'Say something while the disk is full')
        console.log(
          `   message outcome on a full disk: ${reply._}${
            reply.message ? ` (${String(reply.message).slice(0, 120)})` : ''
          }`,
        )
        const failed = query<{status: string; error_cbor: Uint8Array | null}>(
          ramDb,
          `SELECT status, error_cbor FROM runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
          [sessionId],
        )[0]
        assert(failed?.status !== 'succeeded', 'the run finished as a success on a full disk')
        const requestsBefore = modelRequests
        fs.rmSync(filler, {force: true})
        // A restart exercises the sweep over whatever the failed turn left, then the session is retried.
        await current().stop()
        daemon = await startDaemon({dbPath: ramDb, dataDir: ramDataDir, env: {SEED_AGENTS_MIN_FREE_DISK_MIB: '0'}})
        let status = await waitForRun(current(), sessionId)
        if (status !== 'succeeded') {
          const retried = await action(current(), {_: 'RetrySession', sessionId})
          assert(retried._ === 'RetrySessionResponse', `RetrySession: ${retried.message}`)
          status = await waitForRun(current(), sessionId)
        }
        assert(status === 'succeeded', `run ended ${status} after recovery`)
        const events = await sessionEvents(current(), sessionId)
        assertWellFormed(events, 'after recovery')
        const answers = events.filter(
          (event) => event.type === 'message' && event.content === 'An answer written onto a full disk.',
        )
        assert(answers.length === 1, `expected one answer in the log, found ${answers.length}`)
        console.log(`   model requests: ${requestsBefore} before recovery, ${modelRequests} in total`)
        await current().stop()
      },
    )
  } finally {
    if (daemon && daemon.proc.exitCode === null) await daemon.stop('SIGKILL').catch(() => {})
    if (device) Bun.spawnSync(['hdiutil', 'detach', device, '-force'])
  }
}

console.log('\n[smoke] stopping stand-ins')
for (const release of hungDownloads.splice(0)) release(new Response('gone', {status: 503}))
await model.stop(true)
await fileHost.stop(true)
await hmStub.stop(true)
await rm(scratch, {recursive: true, force: true})
if (failures === 0) console.log('\nOutbox smoke test passed.')
else console.error(`\n${failures} scenario(s) failed.`)

// ---------------------------------------------------------------------------------------------

function sse(chunks: unknown[]): Response {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: {'content-type': 'text/event-stream'},
  })
}

function usage() {
  return {prompt_tokens: 7, completion_tokens: 3, total_tokens: 10}
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await Bun.sleep(200)
  }
  throw new Error(`condition not met within ${timeoutMs}ms`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
