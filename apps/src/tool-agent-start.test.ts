import {Database} from 'bun:sqlite'
import {describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import {createSeedClient, unpackHmId} from '@seed-hypermedia/client'
import {memoryRootPath} from '@/agent-memory'
import * as appRunning from '@/app-running'
import {APP_TOOL_MEMORY_DIR_ENV, type CodeExecutor} from '@/code-exec'
import * as sqlite from '@/sqlite'

const SERVER = 'http://this-server.test/hm/api/apps'
const SPACE = 'z6MkspaceAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const VIEWER = 'z6MkviewerAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const VERSION = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

// Check first, then hand over: wakes the agent only for work it has not seen.
const TOOL_SOURCE = `export default async function (input: {items: string[]; starts?: number}, ctx: any) {
  const fresh = []
  for (const item of input.items) if ((await ctx.memory.read('seen/' + item)) === null) fresh.push(item)
  for (const item of fresh) await ctx.memory.write('seen/' + item, 'seen')
  const sessions = []
  let refused = null
  if (fresh.length) {
    for (let i = 0; i < (input.starts ?? 1); i++) {
      try {
        sessions.push((await ctx.agent.start('Triage ' + fresh.join(', '), {title: 'Triage', tools: ['read']})).sessionId)
      } catch (error) {
        refused = (error as Error).message
      }
    }
  }
  return {fresh, sessions, refused}
}
`

function document(url: string, metadata: Record<string, unknown>, content: unknown[] = []) {
  return {
    type: 'document',
    id: unpackHmId(url),
    document: {
      content,
      metadata,
      version: VERSION,
      genesis: VERSION,
      account: SPACE,
      authors: [SPACE],
      path: '',
      createTime: '',
      updateTime: '',
      visibility: 'PUBLIC',
    },
  }
}

describe('ctx.agent.start', () => {
  test('an agent’s tool checks first and wakes the agent only when there is work', async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('schema')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-tool-agent-start-test-'))
    const agentStateDir = path.join(dataDir, 'agents', 'maple')
    const originalFetch = globalThis.fetch
    const agent = `hm://${SPACE}/maple`
    const agentTool = `${agent}/triage`
    const app = `hm://${SPACE}/inbox`
    const appTool = `${app}/triage`
    const started: {hostId: string; message: string; title?: string; tools?: string[]; runId: string}[] = []
    let deps!: appRunning.AppRunDeps
    const route = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const token = /^Bearer (.+)$/u.exec(req.headers.get('authorization') ?? '')?.[1] ?? ''
        try {
          return Response.json({result: await appRunning.toolSeedRequest(deps, token, await req.json())})
        } catch (error) {
          return Response.json({error: (error as Error).message}, {status: (error as {status?: number}).status ?? 500})
        }
      },
    })
    const codeExec: CodeExecutor = {
      enabled: true,
      drain: async () => {},
      probe: async () => ({ok: true, bootMs: 0, durationMs: 0}),
      runtimes: ['ts'],
      availability: async () => ({available: true, runtimes: ['ts']}),
      execute: async (request) => {
        const memory = memoryRootPath(request.stateDir)
        fs.mkdirSync(memory, {recursive: true})
        const run = Bun.spawn(['bun', '-e', request.code], {
          env: {...process.env, ...request.env, [APP_TOOL_MEMORY_DIR_ENV]: memory},
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(run.stdout).text(),
          new Response(run.stderr).text(),
          run.exited,
        ])
        return {
          exitCode,
          success: exitCode === 0,
          stdout,
          stderr,
          truncated: false,
          durationMs: 1,
          bootMs: 0,
          changedFiles: [],
          changedFilesTotal: 0,
        }
      },
    }
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.startsWith(`http://localhost:${route.port}`)) return originalFetch(url as never, init)
      if (href.includes('/ipfs/bafycode/index.ts')) return new Response(TOOL_SOURCE)
      if (href.startsWith(`${SERVER}/health`)) return Response.json({serverId: 'this-server'})
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/Resource')) {
        const tool = href.includes('/maple') ? agentTool : appTool
        if (href.includes('/triage'))
          return Response.json(
            serialize(document(tool, {name: 'triage', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'})),
          )
        const card = [{block: {id: 'b', type: 'Embed', link: tool, attributes: {view: 'Card'}}, children: []}]
        if (href.includes('/maple'))
          return Response.json(
            serialize(document(agent, {name: 'Maple', type: 'hm://hyper.media/agent', agentServerUrl: SERVER}, card)),
          )
        if (href.includes('/inbox'))
          return Response.json(
            serialize(document(app, {name: 'Inbox', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER}, card)),
          )
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    deps = {
      db,
      client: createSeedClient('https://hm.test'),
      ipfsServerUrl: 'https://hm.test',
      dataDir,
      codeExec,
      encrypt: (plain) => plain,
      decrypt: (ciphertext) => ciphertext,
      serverId: 'this-server',
      holdsSigningKey: () => false,
      toolSeed: {url: `http://localhost:${route.port}/tool-seed`},
      agentStateDir: (hostId) => (hostId === agent ? agentStateDir : null),
      startAgentSession: async (hostId, start) => {
        started.push({hostId, ...start})
        return {sessionId: `session-${started.length}`}
      },
    }
    db.query(`INSERT INTO app_runs (app_id, space_uid, started_by, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`).run(
      app,
      SPACE,
      SPACE,
    )
    db.query('INSERT INTO accounts (id, created_at, updated_at) VALUES (?, 1, 1)').run(SPACE)
    db.query(
      `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ready', 1, 1)`,
    ).run(agent, SPACE, new Uint8Array([160]), agentStateDir)
    const call = (caller: string, host: string, tool: string, input: unknown) =>
      appRunning.callAppTool(deps, caller, {appId: host, toolId: tool, input}) as Promise<{
        output?: any
        error?: string
        sessions?: {sessionId: string}[]
      }>
    try {
      // New work: one session, with the message and options the tool chose, recorded on the call.
      const first = await call(SPACE, agent, agentTool, {items: ['a', 'b']})
      expect(first.output).toEqual({fresh: ['a', 'b'], sessions: ['session-1'], refused: null})
      expect(first.sessions).toEqual([{sessionId: 'session-1', at: expect.any(Number)}])
      expect(started).toEqual([
        {
          hostId: agent,
          message: 'Triage a, b',
          title: 'Triage',
          tools: ['read'],
          runId: expect.stringMatching(/^tool-call-/),
        },
      ])
      // Nothing new: the model is not woken at all.
      expect((await call(SPACE, agent, agentTool, {items: ['a', 'b']})).output).toEqual({
        fresh: [],
        sessions: [],
        refused: null,
      })
      expect(started).toHaveLength(1)
      // At most three per call.
      expect((await call(SPACE, agent, agentTool, {items: ['c'], starts: 4})).output).toMatchObject({
        sessions: ['session-2', 'session-3', 'session-4'],
        refused: expect.stringContaining('at most 3 times'),
      })
      // A viewer's call cannot wake the agent (a model run costs).
      expect((await call(VIEWER, agent, agentTool, {items: ['d']})).output).toMatchObject({
        sessions: [],
        refused: expect.stringContaining('writers and its triggers'),
      })
      // An app has no agent to wake.
      expect((await call(SPACE, app, appTool, {items: ['e']})).output).toMatchObject({
        sessions: [],
        refused: expect.stringContaining('an app has no agent to start'),
      })
      expect(started).toHaveLength(4)
    } finally {
      globalThis.fetch = originalFetch
      route.stop(true)
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  })
})
