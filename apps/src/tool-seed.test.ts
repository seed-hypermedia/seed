import {Database} from 'bun:sqlite'
import {describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import {createSeedClient, unpackHmId} from '@seed-hypermedia/client'
import * as appRunning from '@/app-running'
import type {CodeExecutor} from '@/code-exec'
import * as hostConfig from '@/host-config'
import * as sqlite from '@/sqlite'

const SERVER = 'http://this-server.test/hm/api/apps'
const SPACE = 'z6MkspaceAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const WRITER = 'z6MkwriterAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const VIEWER = 'z6MkviewerAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const APP_KEY = 'z6MkappkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const APP = `hm://${SPACE}/recipes`
const TOOL = `hm://${SPACE}/recipes/shopping`
const SCHEMA_CID = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

// Reads the week's recipes and writes the shopping list, signed as the app.
const TOOL_SOURCE = `export default async function (input: {week: string}, ctx: any) {
  const recipes = await ctx.seed.directory('hm://${SPACE}/recipes/recipes')
  const items: Record<string, boolean> = {}
  for (const recipe of recipes) for (const item of Object.keys(recipe.metadata.ingredients ?? {})) items[item] = true
  const one = await ctx.seed.resource(recipes[0])
  const written = await ctx.seed.publish('hm://${SPACE}/recipes/lists/' + input.week, {
    name: 'Week ' + input.week,
    metadata: {items},
    content: Object.keys(items).map((item) => '- ' + item).join('\\n'),
  })
  let privateRead = 'allowed'
  await ctx.seed.resource('hm://${SPACE}/recipes/secret').catch((error: Error) => (privateRead = error.message))
  return {items: Object.keys(items).sort(), first: one.metadata.name, version: written.version, privateRead}
}
`

/** A directory entry as the daemon lists it. */
function info(slug: string, metadata: Record<string, unknown>, visibility = 'PUBLIC') {
  return {
    type: 'document',
    id: unpackHmId(`hm://${SPACE}/recipes/recipes/${slug}`),
    path: ['recipes', 'recipes', slug],
    authors: [],
    createTime: '2026-01-01T00:00:00Z',
    updateTime: '2026-02-02T00:00:00Z',
    sortTime: new Date('2026-02-02T00:00:00Z'),
    genesis: 'gen',
    version: 'v1',
    breadcrumbs: [],
    activitySummary: {
      latestCommentId: '',
      commentCount: 0,
      latestChangeTime: '2026-02-02T00:00:00Z',
      isUnread: false,
      childrenCount: 0,
    },
    generationInfo: {genesis: 'gen', generation: 1n},
    metadata,
    visibility,
  }
}

function document(url: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    type: 'document',
    id: unpackHmId(url),
    document: {
      content: [],
      metadata,
      version: SCHEMA_CID,
      genesis: SCHEMA_CID,
      account: SPACE,
      authors: [SPACE],
      path: '',
      createTime: '',
      updateTime: '',
      visibility: 'PUBLIC',
      ...extra,
    },
  }
}

describe('ctx.seed', () => {
  test('a tool reads public documents and publishes as the app’s key; viewers cannot call it', async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('schema')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-tool-seed-test-'))
    const originalFetch = globalThis.fetch
    const published: {keyAccount: string; id: string; name?: string; metadata?: unknown; content?: string}[] = []
    let deps!: appRunning.AppRunDeps
    // This server's tool-seed route, as the sandbox reaches it.
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
        expect(request.hostPort).toBe(4242)
        // Async, so this process can serve the tool's ctx.seed requests while it runs.
        const run = Bun.spawn(['bun', '-e', request.code], {
          env: {...process.env, ...request.env},
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
      if (href.includes('/api/ListCapabilities'))
        return Response.json(
          serialize({
            capabilities: [{id: 'c', issuer: SPACE, delegate: WRITER, account: SPACE, path: '', role: 'WRITER'}],
          }),
        )
      if (href.includes('/api/GetCID'))
        return Response.json(
          serialize({
            value: {
              type: 'hm://hyper.media/struct',
              properties: {publisher: {value: {type: 'hm://hyper.media/signing-key'}}},
            },
          }),
        )
      if (href.includes('/api/Query'))
        return Response.json(
          serialize({
            in: unpackHmId(`hm://${SPACE}/recipes/recipes`),
            mode: 'Children',
            results: [
              info('soup', {name: 'Soup', ingredients: {leek: true, potato: true}}),
              info('tart', {name: 'Tart', ingredients: {leek: true, eggs: true}}),
              info('hidden', {name: 'Hidden'}, 'PRIVATE'),
            ],
          }),
        )
      if (href.includes('/api/Resource')) {
        if (href.includes('/recipes/shopping'))
          return Response.json(
            serialize(document(TOOL, {name: 'shopping', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'})),
          )
        if (href.includes('/recipes/recipes/soup'))
          return Response.json(serialize(document(`hm://${SPACE}/recipes/recipes/soup`, {name: 'Soup'})))
        if (href.includes('/recipes/secret'))
          return Response.json(
            serialize(document(`hm://${SPACE}/recipes/secret`, {name: 'Secret'}, {visibility: 'PRIVATE'})),
          )
        if (href.includes('/recipes'))
          return Response.json(
            serialize(
              document(
                APP,
                {
                  name: 'Recipes',
                  type: 'hm://hyper.media/app',
                  appEnvironmentUrl: SERVER,
                  privateConfigSchema: `ipfs://${SCHEMA_CID}`,
                },
                {content: [{block: {id: 'b1', type: 'Embed', link: TOOL, attributes: {view: 'Card'}}, children: []}]},
              ),
            ),
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
      holdsSigningKey: (account, key) => account === SPACE && key === APP_KEY,
      toolSeed: {url: `http://localhost:${route.port}/tool-seed`, hostPort: 4242},
      publishAs: async (keyAccount, doc) => {
        published.push({keyAccount, id: doc.id.id, name: doc.name, metadata: doc.metadata, content: doc.content})
        return {version: 'bafynewversion'}
      },
    }
    // The app runs, with its key attached by the owner.
    hostConfig.writePrivateConfig(db, deps, {hostId: APP, spaceUid: SPACE}, {publisher: APP_KEY}, SPACE)
    db.query(`INSERT INTO app_runs (app_id, space_uid, started_by, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`).run(
      APP,
      SPACE,
      SPACE,
    )
    try {
      // A writer (or a trigger, which calls as its author) runs it: the list is written as the app.
      const call = await appRunning.callAppTool(deps, WRITER, {appId: APP, toolId: TOOL, input: {week: '47'}})
      expect(call.error).toBeUndefined()
      expect(call.output).toEqual({
        items: ['eggs', 'leek', 'potato'],
        first: 'Soup',
        version: 'bafynewversion',
        privateRead: expect.stringContaining('private: tools read only public documents'),
      })
      expect(published).toEqual([
        {
          keyAccount: APP_KEY,
          id: `hm://${SPACE}/recipes/lists/47`,
          name: 'Week 47',
          metadata: {items: {leek: true, potato: true, eggs: true}},
          content: '- leek\n- potato\n- eggs',
        },
      ])
      // The call records what it published, and as whom.
      expect(call.writes).toEqual([
        {id: `hm://${SPACE}/recipes/lists/47`, version: 'bafynewversion', as: APP_KEY, at: expect.any(Number)},
      ])
      expect((await appRunning.getAppToolCall(deps, {callId: call.id}, [WRITER])).writes).toHaveLength(1)

      // A viewer cannot call it at all (the tool does not allow viewers), so it cannot make the app
      // publish: no confused deputy.
      await expect(
        appRunning.callAppTool(deps, VIEWER, {appId: APP, toolId: TOOL, input: {week: '48'}}),
      ).rejects.toThrow('Only the writers of this app or agent')
      expect(published).toHaveLength(1)

      // Once a call is over its token is worthless.
      await expect(appRunning.toolSeedRequest(deps, 'not-a-token', {op: 'resource', id: APP})).rejects.toThrow(
        'This tool call is over',
      )
    } finally {
      globalThis.fetch = originalFetch
      route.stop(true)
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  })
})
