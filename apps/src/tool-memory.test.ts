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

// Keeps receipts in its host's memory, the way ion's Discord post does, so it never sends twice.
const TOOL_SOURCE = `export default async function (input: {event: string}, ctx: any) {
  const receipts = JSON.parse((await ctx.memory.read('receipts.json')) ?? '{}')
  const duplicate = !!receipts[input.event]
  receipts[input.event] = true
  await ctx.memory.write('receipts.json', receipts)
  let escaped = 'refused'
  await ctx.memory.read('../../outside').then(() => (escaped = 'read'), () => {})
  return {duplicate, seen: Object.keys(receipts).length, files: await ctx.memory.list(), escaped}
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

describe('tool memory', () => {
  test('a tool keeps state in its host’s memory; only callers it allows may run it', async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('schema')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-tool-memory-test-'))
    const agentStateDir = path.join(dataDir, 'agents', 'maple')
    const originalFetch = globalThis.fetch
    const app = `hm://${SPACE}/inbox`
    const appTool = `${app}/post`
    const agent = `hm://${SPACE}/maple`
    const agentTool = `${agent}/post`
    const memoryChanged: string[] = []
    const codeExec: CodeExecutor = {
      enabled: true,
      drain: async () => {},
      probe: async () => ({ok: true, bootMs: 0, durationMs: 0}),
      runtimes: ['ts'],
      availability: async () => ({available: true, runtimes: ['ts']}),
      // Runs the program as the sandbox would, with its memory where the VM mounts it.
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
          changedFiles: [{path: 'receipts.json', change: 'modified' as const}],
          changedFilesTotal: 1,
        }
      },
    }
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.includes('/ipfs/bafycode/index.ts')) return new Response(TOOL_SOURCE)
      if (href.startsWith(`${SERVER}/health`)) return Response.json({serverId: 'this-server'})
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/Resource')) {
        if (href.endsWith('/post') || href.includes('/post&') || href.includes('/post"'))
          return Response.json(
            serialize(
              // The app's tool allows viewers; the agent's does not.
              document(href.includes('/maple') ? agentTool : appTool, {
                name: 'post',
                type: 'hm://hyper.media/tool',
                code: 'ipfs://bafycode',
                ...(href.includes('/maple') ? {} : {callableBy: 'viewers'}),
              }),
            ),
          )
        if (href.includes('/maple'))
          return Response.json(
            serialize(
              document(agent, {name: 'Maple', type: 'hm://hyper.media/agent', agentServerUrl: SERVER}, [
                {block: {id: 'b', type: 'Embed', link: agentTool, attributes: {view: 'Card'}}, children: []},
              ]),
            ),
          )
        if (href.includes('/inbox'))
          return Response.json(
            serialize(
              document(app, {name: 'Inbox', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER}, [
                {block: {id: 'b', type: 'Embed', link: appTool, attributes: {view: 'Card'}}, children: []},
              ]),
            ),
          )
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const deps: appRunning.AppRunDeps = {
      db,
      client: createSeedClient('https://hm.test'),
      ipfsServerUrl: 'https://hm.test',
      dataDir,
      codeExec,
      encrypt: (plain) => plain,
      decrypt: (ciphertext) => ciphertext,
      serverId: 'this-server',
      holdsSigningKey: () => false,
      agentStateDir: (hostId) => (hostId === agent ? agentStateDir : null),
      onAgentMemoryChanged: (hostId) => memoryChanged.push(hostId),
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
    const call = async (caller: string, host: string, tool: string, event: string) =>
      (await appRunning.callAppTool(deps, caller, {appId: host, toolId: tool, input: {event}}).catch((error) => ({
        refused: (error as Error).message,
      }))) as {output?: any; error?: string; refused?: string}
    try {
      // The app's writer (a trigger calls as its author): the app's private memory persists.
      expect((await call(SPACE, app, appTool, 'c1')).output).toMatchObject({
        duplicate: false,
        seen: 1,
        files: ['receipts.json'],
        escaped: 'refused',
      })
      expect((await call(SPACE, app, appTool, 'c1')).output).toMatchObject({duplicate: true, seen: 1})
      // A tool that allows viewers runs for a viewer with the app's memory, like any call.
      expect((await call(VIEWER, app, appTool, 'c2')).output).toMatchObject({duplicate: false, seen: 2})
      expect((await call(SPACE, app, appTool, 'c2')).output).toMatchObject({duplicate: true, seen: 2})
      // A tool that does not allow viewers refuses them before it runs.
      expect((await call(VIEWER, agent, agentTool, 'v1')).refused).toContain('Only the writers of this app or agent')
      // An agent's tool works in the agent's own memory, and clients watching it hear of the change.
      expect((await call(SPACE, agent, agentTool, 'a1')).output).toMatchObject({seen: 1})
      expect(JSON.parse(fs.readFileSync(path.join(memoryRootPath(agentStateDir), 'receipts.json'), 'utf8'))).toEqual({
        a1: true,
      })
      expect(memoryChanged).toEqual([agent])
    } finally {
      globalThis.fetch = originalFetch
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  })
})
