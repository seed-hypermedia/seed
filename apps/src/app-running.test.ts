import {Database} from 'bun:sqlite'
import {describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import * as apisvc from '@/api-service'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import {unpackHmId} from '@seed-hypermedia/client'
import type {CodeExecRequest} from '@/code-exec'
import {createRunningAppsHandlers} from '@/main'

function createTestState() {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-app-running-test-'))
  return {db, dataDir, cleanup: () => fs.rmSync(dataDir, {recursive: true, force: true})}
}

const TOOL_SOURCE = `export default async function (input: {city: string}, ctx: any) {
  if (!ctx.privateConfig.apiKey) throw new Error('This app needs an apiKey')
  return {city: input.city, units: ctx.publicConfig.units, keyLength: ctx.privateConfig.apiKey.length, app: ctx.app}
}
`

describe('running apps', () => {
  test('a writer runs an app with private config, anyone calls its tools, calls are recorded', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const owner = blobs.generateNobleKeyPair()
    const stranger = blobs.generateNobleKeyPair()
    const space = blobs.principalToString(owner.principal)
    const appUrl = `hm://${space}/weather`
    const toolUrl = `hm://${space}/weather/get-weather`
    const executions: CodeExecRequest[] = []
    const svc = new apisvc.Service(db, dataDir, {
      hmServerUrl: 'https://hm.test',
      runQueue: {maxConcurrentModelRuns: 0},
      codeExecutor: {
        enabled: true,
        drain: async () => {},
        probe: async () => ({ok: true, bootMs: 0, durationMs: 0}),
        runtimes: ['ts'],
        availability: async () => ({available: true, runtimes: ['ts']}),
        // The sandbox is not available in tests, but the program is just bun input: run it with the
        // same env the sandbox would get, so private config delivery is exercised for real.
        execute: async (request) => {
          executions.push(request)
          const run = Bun.spawnSync(['bun', '-e', request.code], {env: {...process.env, ...request.env}})
          return {
            exitCode: run.exitCode,
            success: run.exitCode === 0,
            stdout: run.stdout.toString(),
            stderr: run.stderr.toString(),
            truncated: false,
            durationMs: 1,
            bootMs: 0,
            changedFiles: [],
            changedFilesTotal: 0,
          }
        },
      },
    })
    const document = (url: string, metadata: Record<string, unknown>, content: unknown[] = []) => ({
      type: 'document',
      id: unpackHmId(url),
      document: {
        content,
        metadata,
        version: 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        genesis: 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        account: space,
        authors: [space],
        path: '',
        createTime: '',
        updateTime: '',
        visibility: 'PUBLIC',
      },
    })
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.includes('/ipfs/bafycode/index.ts')) return new Response(TOOL_SOURCE)
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/Resource')) {
        if (href.includes('/weather/get-weather'))
          return Response.json(
            serialize(document(toolUrl, {name: 'get-weather', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'})),
          )
        if (href.includes('/weather'))
          return Response.json(
            serialize(
              document(appUrl, {name: 'Weather', type: 'hm://hyper.media/app', publicConfig: {units: 'metric'}}, [
                {block: {id: 'b1', type: 'Embed', link: toolUrl, attributes: {view: 'Card'}}, children: []},
              ]),
            ),
          )
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const send = async (key: blobs.NobleKeyPair, action: Record<string, unknown>) => {
      try {
        return await svc.message(await apisvc.createSignedEnvelope(key, {action: action as never}))
      } catch (error) {
        return {error: error instanceof Error ? error.message : String(error)}
      }
    }
    try {
      // Only a writer of the app's space can run it.
      expect(await send(stranger, {_: 'RunApp', appId: appUrl, privateConfig: {apiKey: 'x'}})).toMatchObject({
        error: expect.stringContaining('write to the app'),
      })
      // Calling before it runs says so.
      expect(
        await send(stranger, {_: 'CallAppTool', appId: appUrl, toolId: toolUrl, input: {city: 'Lisbon'}}),
      ).toMatchObject({
        error: expect.stringContaining('not running'),
      })

      const run = await send(owner, {_: 'RunApp', appId: appUrl, privateConfig: {apiKey: 'dummy-key'}})
      expect(run).toMatchObject({
        _: 'AppRunResponse',
        run: {appId: appUrl, spaceUid: space, privateConfigKeys: ['apiKey']},
      })
      // The value never comes back.
      expect(JSON.stringify(run)).not.toContain('dummy-key')
      expect(await send(stranger, {_: 'GetAppRun', appId: appUrl})).toMatchObject({
        run: {privateConfigKeys: ['apiKey']},
      })

      // Anyone may call; the tool sees public config and the private key through ctx.
      const call = await send(stranger, {_: 'CallAppTool', appId: appUrl, toolId: toolUrl, input: {city: 'Lisbon'}})
      expect(call).toMatchObject({
        _: 'AppToolCallResponse',
        call: {output: {city: 'Lisbon', units: 'metric', keyLength: 9, app: appUrl}, toolId: toolUrl},
      })
      // The key travelled in the environment, never in the program.
      expect(executions[0]!.code).not.toContain('dummy-key')
      expect(executions[0]!.env?.SEED_APP_PRIVATE_CONFIG).toContain('dummy-key')

      // A tool that is not listed by the app cannot be called through it.
      expect(
        await send(stranger, {_: 'CallAppTool', appId: appUrl, toolId: `hm://${space}/weather/other`, input: {}}),
      ).toMatchObject({error: expect.stringContaining('not a tool of this app')})

      const history = await send(stranger, {_: 'ListAppToolCalls', toolId: toolUrl})
      expect(history).toMatchObject({
        _: 'ListAppToolCallsResponse',
        calls: [{input: {city: 'Lisbon'}, output: {city: 'Lisbon'}}],
      })

      // The same, over plain HTTP: the list, the app with its tools, a tool with its calls, a call.
      const http = createRunningAppsHandlers(svc)
      const base = 'http://apps.test/hm/api/apps'
      expect(await (await http.list()).json()).toMatchObject({apps: [{appId: appUrl}]})
      expect(await (await http.read(new Request(`${base}/${space}/weather`))).json()).toMatchObject({
        name: 'Weather',
        run: {appId: appUrl},
        tools: [{id: toolUrl, name: 'get-weather'}],
      })
      expect(await (await http.read(new Request(`${base}/${space}/weather/get-weather`))).json()).toMatchObject({
        app: appUrl,
        tool: {id: toolUrl},
        calls: [{input: {city: 'Lisbon'}}],
      })
      // Calling is signed: an anonymous POST is refused with where to send the signed action.
      const posted = await http.call()
      expect(posted.status).toBe(405)
      expect(await posted.json()).toMatchObject({error: expect.stringContaining('CallAppTool')})
      expect((await http.read(new Request(`${base}/${space}/nope`))).status).toBe(404)

      // A run is readable on its own, with who triggered it and the tool version that ran.
      const one = await send(stranger, {_: 'GetAppToolCall', callId: (call as {call: {id: string}}).call.id})
      expect(one).toMatchObject({
        _: 'AppToolCallResponse',
        call: {caller: blobs.principalToString(stranger.principal), toolId: toolUrl, toolVersion: expect.any(String)},
      })
      expect(await send(stranger, {_: 'GetAppToolCall', callId: 'nope'})).toMatchObject({
        error: expect.stringContaining('No such run'),
      })

      // Updating private config merges: fields not given keep their values.
      expect(await send(owner, {_: 'RunApp', appId: appUrl, privateConfig: {}})).toMatchObject({
        run: {privateConfigKeys: ['apiKey']},
      })

      // Stopping forgets the run and its private config.
      expect(await send(owner, {_: 'StopApp', appId: appUrl})).toMatchObject({run: null})
      expect(await send(owner, {_: 'GetAppRun', appId: appUrl})).toMatchObject({run: null})
      expect(db.query('SELECT count(*) AS n FROM app_runs').get()).toEqual({n: 0})
    } finally {
      globalThis.fetch = originalFetch
      cleanup()
    }
  })
})
