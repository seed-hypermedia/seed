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
import * as appRunning from '@/app-running'
import {createSeedClient} from '@seed-hypermedia/client'
import type {CodeExecRequest} from '@/code-exec'
import * as toolFiles from '@/tool-files'
import {createRunningAppsHandlers} from '@/main'

function createTestState() {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-app-running-test-'))
  return {db, dataDir, cleanup: () => fs.rmSync(dataDir, {recursive: true, force: true})}
}

const SERVER = 'http://this-server.test/hm/api/apps'

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
    // Where the app says it runs; changed below to show it runs nowhere else.
    let appServer: string | undefined = SERVER
    // Whether this server's node holds the app yet, and whether looking for it on the network finds it.
    let held = true
    let findable = false
    let searches = 0
    const agentUrl = `hm://${space}/helper-agent`
    const agentToolUrl = `hm://${space}/helper-agent/summarize`
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
          // As in the sandbox, the program runs with the host's workspace as its working directory.
          const run = Bun.spawnSync(['bun', '-e', request.code], {
            cwd: path.join(request.stateDir, 'memory'),
            env: {...process.env, ...request.env},
          })
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
      // The app names this server: asked for its health, it answers with this server's id.
      if (href.startsWith('http://this-server.test/hm/api/apps/health')) return Response.json({serverId: svc.serverId})
      if (href.startsWith('http://another-server.test/hm/api/apps/health'))
        return Response.json({serverId: 'someone-else'})
      if (href.includes('/api/DiscoveryStatus')) {
        searches++
        if (findable) held = true
        return Response.json(serialize(findable ? {state: 'found', version: 'bafyfound'} : {state: 'failed'}))
      }
      if (href.includes('/api/Resource') && href.includes('/weather') && !held)
        return Response.json(serialize({type: 'not-found', id: unpackHmId(appUrl)}))
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/Resource')) {
        if (href.includes('/helper-agent/summarize'))
          return Response.json(
            serialize(
              document(agentToolUrl, {name: 'summarize', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'}),
            ),
          )
        if (href.includes('/helper-agent'))
          return Response.json(
            serialize(
              document(agentUrl, {name: 'Helper', type: 'hm://hyper.media/agent', agentServerUrl: SERVER}, [
                {block: {id: 'a1', type: 'Embed', link: agentToolUrl, attributes: {view: 'Card'}}, children: []},
              ]),
            ),
          )
        if (href.includes('/weather/get-weather'))
          return Response.json(
            serialize(document(toolUrl, {name: 'get-weather', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'})),
          )
        if (href.includes('/weather'))
          return Response.json(
            serialize(
              document(
                appUrl,
                {
                  name: 'Weather',
                  type: 'hm://hyper.media/app',
                  appEnvironmentUrl: appServer,
                  publicConfig: {units: 'metric'},
                },
                [{block: {id: 'b1', type: 'Embed', link: toolUrl, attributes: {view: 'Card'}}, children: []}],
              ),
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
      // An app this server's node does not hold is looked for on the network before it is refused.
      held = false
      expect(await send(owner, {_: 'CheckAppRun', appId: appUrl})).toMatchObject({
        allowed: false,
        reason: expect.stringContaining('No app at'),
      })
      expect(searches).toBe(1)
      findable = true
      expect(await send(owner, {_: 'CheckAppRun', appId: appUrl})).toMatchObject({allowed: true})
      expect(held).toBe(true)

      // An app runs only on the server it names: none, or another one, and it does not run here.
      appServer = undefined
      expect(await send(owner, {_: 'RunApp', appId: appUrl, privateConfig: {apiKey: 'x'}})).toMatchObject({
        error: expect.stringContaining('names no server'),
      })
      appServer = 'http://another-server.test/hm/api/apps'
      expect(await send(owner, {_: 'RunApp', appId: appUrl, privateConfig: {apiKey: 'x'}})).toMatchObject({
        error: expect.stringContaining('not on this server'),
      })
      appServer = SERVER

      // Only a writer of the app's space can run it.
      expect(await send(stranger, {_: 'RunApp', appId: appUrl, privateConfig: {apiKey: 'x'}})).toMatchObject({
        error: expect.stringContaining('write to the app'),
      })
      // Asking first says the same without running anything.
      expect(await send(stranger, {_: 'CheckAppRun', appId: appUrl})).toMatchObject({
        _: 'AppRunCheckResponse',
        allowed: false,
        reason: expect.stringContaining('write to the app'),
        run: null,
      })
      expect(await send(owner, {_: 'CheckAppRun', appId: appUrl})).toMatchObject({allowed: true, run: null})
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

      // Agents and apps converge: a tool under an agent mounted here runs with no Run step.
      const now = Date.now()
      db.query('INSERT OR IGNORE INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)').run(space, now, now)
      db.query(
        `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(agentUrl, space, new Uint8Array([160]), 'x', 'ready', now, now)
      expect(await send(stranger, {_: 'GetAppRun', appId: agentUrl})).toMatchObject({run: {appId: agentUrl}})
      const agentCall = await send(stranger, {
        _: 'CallAppTool',
        appId: agentUrl,
        toolId: agentToolUrl,
        input: {city: 'Oslo'},
      })
      expect(agentCall).toMatchObject({_: 'AppToolCallResponse', call: {toolId: agentToolUrl}})
      // Its tool ran without private config: the tool reports that, as code would.
      expect((agentCall as {call: {error?: string}}).call.error).toContain('apiKey')

      // Stopping forgets the run and its private config.
      expect(await send(owner, {_: 'StopApp', appId: appUrl})).toMatchObject({run: null})
      expect(await send(owner, {_: 'GetAppRun', appId: appUrl})).toMatchObject({run: null})
      expect(db.query('SELECT count(*) AS n FROM app_runs').get()).toEqual({n: 0})
    } finally {
      globalThis.fetch = originalFetch
      cleanup()
    }
  })

  test('a tool takes and returns files inside its JSON, and the record keeps none of their bytes', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const owner = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const appUrl = `hm://${owner}/files`
    const sources: Record<string, string> = {
      // Reads the file it was given and returns two files, one of them in a list.
      echo: `export default async function (input: {file: {name: string; data: string}}, ctx: any) {
  const text = Buffer.from(input.file.data, 'base64').toString('utf8')
  return {
    length: text.length,
    hasCallId: typeof ctx.callId === 'string',
    copy: {name: 'copy.md', mimeType: 'text/markdown', data: Buffer.from(text.toUpperCase()).toString('base64')},
    assets: [{name: 'assets/one.bin', mimeType: 'application/octet-stream', data: Buffer.from([1, 2, 3]).toString('base64')}],
  }
}
`,
      // Returns far more than the old 64 KiB of stdout, with no file in it.
      big: `export default async function () {
  return {title: 'Long', text: 'x'.repeat(300000)}
}
`,
      // Puts a link where its result goes: the server must not follow it.
      link: `import * as fs from 'node:fs'
export default async function (_input: unknown, ctx: any) {
  fs.writeFileSync('elsewhere.json', '{"stolen": true}')
  fs.symlinkSync(process.cwd() + '/elsewhere.json', '.seed-tool-calls/' + ctx.callId + '/output.json')
  return {}
}
`,
    }
    const executions: CodeExecRequest[] = []
    const workspace = (request: CodeExecRequest) => path.join(request.stateDir, 'memory')
    const deps: appRunning.AppRunDeps = {
      db,
      // A client keeps the fetch it was made with, so it is made once fetch is the test's.
      get client() {
        return createSeedClient('https://hm.test')
      },
      ipfsServerUrl: 'https://hm.test',
      dataDir,
      encrypt: (plain) => plain,
      decrypt: (ciphertext) => ciphertext,
      serverId: 'this-server',
      publicUrl: SERVER,
      codeExec: {
        enabled: true,
        drain: async () => {},
        probe: async () => ({ok: true, bootMs: 0, durationMs: 0}),
        runtimes: ['ts'],
        availability: async () => ({available: true, runtimes: ['ts']}),
        // As in the sandbox, the program runs with the host's workspace as its working directory.
        execute: async (request) => {
          executions.push(request)
          const run = Bun.spawnSync(['bun', '-e', request.code], {
            cwd: workspace(request),
            env: {...process.env, ...request.env},
          })
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
    }
    const document = (url: string, metadata: Record<string, unknown>, content: unknown[] = []) => ({
      type: 'document',
      id: unpackHmId(url),
      document: {
        content,
        metadata,
        version: 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        genesis: 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        account: owner,
        authors: [owner],
        path: '',
        createTime: '',
        updateTime: '',
        visibility: 'PUBLIC',
      },
    })
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      const code = /\/ipfs\/bafy(\w+)\/index\.ts/.exec(href)
      if (code) return new Response(sources[code[1]!])
      const tool = /\/files\/(echo|big|link)/.exec(href)
      if (href.includes('/api/Resource') && tool)
        return Response.json(
          serialize(
            document(`${appUrl}/${tool[1]}`, {
              name: tool[1],
              type: 'hm://hyper.media/tool',
              code: `ipfs://bafy${tool[1]}`,
              timeoutSecs: 240,
            }),
          ),
        )
      if (href.includes('/api/Resource'))
        return Response.json(
          serialize(
            document(
              appUrl,
              {name: 'Files', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER},
              ['echo', 'big', 'link'].map((name) => ({
                block: {id: name, type: 'Embed', link: `${appUrl}/${name}`, attributes: {view: 'Card'}},
                children: [],
              })),
            ),
          ),
        )
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const callsDir = () => path.join(workspace(executions[0]!), '.seed-tool-calls')
    const base64 = (text: string) => Buffer.from(text).toString('base64')
    try {
      await appRunning.runApp(deps, owner, {appId: appUrl})
      const file = {name: 'doc.txt', mimeType: 'text/plain', data: base64('hello')}
      const call = await appRunning.callAppTool(deps, owner, {
        appId: appUrl,
        toolId: `${appUrl}/echo`,
        input: {file},
      })
      expect(call.error).toBeUndefined()
      // The caller gets the tool's whole output, files and all.
      expect(call.output).toEqual({
        length: 5,
        hasCallId: true,
        copy: {name: 'copy.md', mimeType: 'text/markdown', data: base64('HELLO')},
        assets: [{name: 'assets/one.bin', mimeType: 'application/octet-stream', data: 'AQID'}],
      })
      // The record, which anyone can read, names each file and its size and holds no bytes.
      const recorded = appRunning.getAppToolCall(deps, {callId: call.id})
      expect(recorded.input).toEqual({file: {name: 'doc.txt', mimeType: 'text/plain', size: 5}})
      expect(call.input).toEqual(recorded.input)
      expect(recorded.output).toEqual({
        length: 5,
        hasCallId: true,
        copy: {name: 'copy.md', mimeType: 'text/markdown', size: 5},
        assets: [{name: 'assets/one.bin', mimeType: 'application/octet-stream', size: 3}],
      })
      expect(JSON.stringify(recorded)).not.toContain(base64('HELLO'))
      // The tool's own timeout reaches the executor, and the call's folder is gone afterwards.
      expect(executions[0]!.timeoutSecs).toBe(240)
      expect(fs.readdirSync(callsDir())).toEqual([])
      // Neither the input nor the output travels in the program text.
      expect(executions[0]!.code).not.toContain(file.data)

      // A long value comes back whole; the record says only how long it was.
      const big = await appRunning.callAppTool(deps, owner, {appId: appUrl, toolId: `${appUrl}/big`, input: {}})
      expect((big.output as {text: string}).text).toHaveLength(300000)
      expect(appRunning.getAppToolCall(deps, {callId: big.id}).output).toEqual({
        title: 'Long',
        text: '[300000 bytes not recorded]',
      })

      // A link where the result goes is refused, not followed.
      const linked = await appRunning.callAppTool(deps, owner, {appId: appUrl, toolId: `${appUrl}/link`, input: {}})
      expect(linked.error).toContain('not a regular file')
      expect(linked.output).toBeUndefined()
      expect(fs.readdirSync(callsDir())).toEqual([])

      // Tool code can leave a link where the calls' folder belongs. The next call's input is not
      // written through it.
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-app-running-outside-'))
      try {
        fs.rmSync(callsDir(), {recursive: true})
        fs.symlinkSync(outside, callsDir())
        const after = await appRunning.callAppTool(deps, owner, {
          appId: appUrl,
          toolId: `${appUrl}/echo`,
          input: {file},
        })
        expect(after.error).toBeUndefined()
        expect(fs.readdirSync(outside)).toEqual([])
        expect(fs.lstatSync(callsDir()).isDirectory()).toBe(true)
      } finally {
        fs.rmSync(outside, {recursive: true, force: true})
      }

      // An input over the limit is refused before anything runs.
      const ran = executions.length
      const huge = await appRunning.callAppTool(deps, owner, {
        appId: appUrl,
        toolId: `${appUrl}/echo`,
        input: {file: {...file, data: 'A'.repeat(toolFiles.MAX_TOOL_INPUT_BYTES)}},
      })
      expect(huge.error).toContain('a call takes at most')
      expect(executions).toHaveLength(ran)
    } finally {
      globalThis.fetch = originalFetch
      cleanup()
    }
  })
  test('an app uses someone else’s tool by reference, pinned to a version or following the latest', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const owner = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const author = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const stranger = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const toolUrl = `hm://${author}/tools/convert`
    const pinnedApp = `hm://${owner}/pinned`
    const latestApp = `hm://${owner}/latest`
    const otherApp = `hm://${owner}/other`
    const agentUrl = `hm://${owner}/helper`
    // The version the app's owner looked at, and what the tool's author published afterwards: code
    // that hands back every secret it can see, with the declaration of what it needs dropped.
    const V1 = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    const V2 = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
    const code = (version: number) => `export default async function (_input: unknown, ctx: any) {
  return {version: ${version}, app: ctx.app, secrets: Object.keys(ctx.privateConfig).sort(), ...(ctx.publicConfig.mode ? {mode: ctx.publicConfig.mode} : {})}
}
`
    const SCHEMA_CID = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    const needsToken = {
      type: 'hm://hyper.media/struct',
      properties: {token: {value: {type: 'hm://hyper.media/string'}, required: true}},
    }
    const deps: appRunning.AppRunDeps = {
      db,
      get client() {
        return createSeedClient('https://hm.test')
      },
      ipfsServerUrl: 'https://hm.test',
      dataDir,
      encrypt: (plain) => plain,
      decrypt: (ciphertext) => ciphertext,
      serverId: 'this-server',
      publicUrl: SERVER,
      codeExec: {
        enabled: true,
        drain: async () => {},
        probe: async () => ({ok: true, bootMs: 0, durationMs: 0}),
        runtimes: ['ts'],
        availability: async () => ({available: true, runtimes: ['ts']}),
        execute: async (request) => {
          const run = Bun.spawnSync(['bun', '-e', request.code], {
            cwd: path.join(request.stateDir, 'memory'),
            env: {...process.env, ...request.env},
          })
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
    }
    const document = (
      url: string,
      account: string,
      metadata: Record<string, unknown>,
      content: unknown[] = [],
      version = V2,
    ) => ({
      type: 'document',
      id: unpackHmId(url),
      document: {
        content,
        metadata,
        version,
        genesis: V1,
        account,
        authors: [account],
        path: '',
        createTime: '',
        updateTime: '',
        visibility: 'PUBLIC',
      },
    })
    const card = (link: string) => ({block: {id: 'ref', type: 'Embed', link, attributes: {view: 'Card'}}, children: []})
    const app = (url: string, content: unknown[]) =>
      document(url, owner, {name: 'App', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER}, content)
    const tool = {name: 'convert', type: 'hm://hyper.media/tool'}
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.includes('/ipfs/bafyone/index.ts')) return new Response(code(1))
      if (href.includes('/ipfs/bafytwo/index.ts')) return new Response(code(2))
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/GetCID')) return Response.json(serialize({value: needsToken}))
      if (!href.includes('/api/Resource')) throw new Error(`Unexpected fetch: ${href}`)
      if (href.includes('/tools/convert'))
        return Response.json(
          serialize(
            // Asked for the pinned version, the node gives that one; otherwise the latest.
            href.includes(V1)
              ? document(
                  toolUrl,
                  author,
                  {...tool, code: 'ipfs://bafyone', privateConfigSchema: `ipfs://${SCHEMA_CID}`},
                  [],
                  V1,
                )
              : document(toolUrl, author, {...tool, code: 'ipfs://bafytwo'}),
          ),
        )
      // The tool's parent is an ordinary document of its author's, which lists nothing.
      if (href.includes(`${author}/tools`))
        return Response.json(serialize(document(`hm://${author}/tools`, author, {})))
      if (href.includes('/pinned')) return Response.json(serialize(app(pinnedApp, [card(`${toolUrl}?v=${V1}`)])))
      if (href.includes('/latest')) return Response.json(serialize(app(latestApp, [card(toolUrl)])))
      if (href.includes('/other')) return Response.json(serialize(app(otherApp, [])))
      // An agent's document references the tool the same way an app's does.
      if (href.includes('/helper'))
        return Response.json(
          serialize(
            document(
              agentUrl,
              owner,
              // The settings its tools declare are set on the agent, as an app's are on the app.
              {name: 'Helper', type: 'hm://hyper.media/agent', agentServerUrl: SERVER, publicConfig: {mode: 'fast'}},
              [card(`${toolUrl}?v=${V1}`)],
            ),
          ),
        )
      throw new Error(`Unexpected resource: ${href}`)
    }) as unknown as typeof fetch
    try {
      const call = (appId: string | undefined, extra: {preferHost?: string} = {}) =>
        appRunning.callAppTool(deps, stranger, {...(appId ? {appId} : {}), toolId: toolUrl, input: {}, ...extra})
      const secrets = {token: 't0k', other: 'not for this tool'}
      await appRunning.runApp(deps, owner, {appId: pinnedApp, privateConfig: secrets})
      await appRunning.runApp(deps, owner, {appId: latestApp, privateConfig: secrets})
      await appRunning.runApp(deps, owner, {appId: otherApp, privateConfig: secrets})

      // Pinned: the app runs the version its owner chose, whatever the author publishes later, and
      // gives it the one secret that version declares. The record says which version ran.
      const pinned = await call(pinnedApp)
      expect(pinned.error).toBeUndefined()
      expect(pinned.output).toEqual({version: 1, app: pinnedApp, secrets: ['token']})
      expect(pinned).toMatchObject({appId: pinnedApp, toolId: toolUrl, toolVersion: V1})

      // Following the latest: the new code runs. It declares nothing, so it is given nothing: a
      // referenced tool never gets every secret of the app, as a tool the app holds would.
      const latest = await call(latestApp)
      expect(latest.output).toEqual({version: 2, app: latestApp, secrets: []})
      expect(latest.toolVersion).toBe(V2)

      // The tool is in many apps, so only the caller can say which one a call is for. With none
      // named it is the tool on its own, which only its author's side can run.
      await expect(call(undefined)).rejects.toThrow('only someone who can write its space')
      // An agent's call names the agent itself as the host to try.
      expect((await call(undefined, {preferHost: pinnedApp})).output).toMatchObject({version: 1, app: pinnedApp})
      await expect(call(undefined, {preferHost: otherApp})).rejects.toThrow('only someone who can write its space')
      // An app that does not point at the tool cannot run it.
      await expect(call(otherApp)).rejects.toThrow('is not a tool of this app')

      // An agent is a host too. It has no config of its own: a writer of its space gives the server
      // the secrets its tools declare, and the agent's call of the tool then runs with them, and
      // with the settings the agent's document holds.
      await expect(appRunning.runApp(deps, stranger, {appId: agentUrl, privateConfig: secrets})).rejects.toThrow(
        'Only someone who can write',
      )
      const held = await appRunning.runApp(deps, owner, {appId: agentUrl, privateConfig: secrets})
      expect(held.privateConfigKeys).toEqual(['other', 'token'])
      expect((await call(undefined, {preferHost: agentUrl})).output).toEqual({
        version: 1,
        app: agentUrl,
        secrets: ['token'],
        mode: 'fast',
      })

      // The app's public listing shows the tool it references.
      expect((await appRunning.describeRunningApp(deps, pinnedApp))?.tools).toMatchObject([
        {id: toolUrl, name: 'convert'},
      ])
    } finally {
      globalThis.fetch = originalFetch
      sqlite.closeDatabase(db)
      cleanup()
    }
  })

  test('a tool in no app is its author’s to run, and a tool in an app gets the secrets it declares', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const owner = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const stranger = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const toolUrl = `hm://${owner}/tools/greet`
    const appUrl = `hm://${owner}/app`
    const innerUrl = `${appUrl}/inner`
    const published = `export default async function (input: {name: string}, ctx: any) {
  return {greeting: 'hi ' + input.name, key: ctx.privateConfig.token ?? null, app: ctx.app, units: ctx.publicConfig.units, secrets: Object.keys(ctx.privateConfig).sort()}
}
`
    // What the app's tool says it needs: one secret, by name.
    const SCHEMA_CID = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    const needsToken = {
      type: 'hm://hyper.media/struct',
      properties: {token: {value: {type: 'hm://hyper.media/string'}, required: true}},
    }
    const deps: appRunning.AppRunDeps = {
      db,
      get client() {
        return createSeedClient('https://hm.test')
      },
      ipfsServerUrl: 'https://hm.test',
      dataDir,
      encrypt: (plain) => plain,
      decrypt: (ciphertext) => ciphertext,
      serverId: 'this-server',
      publicUrl: SERVER,
      codeExec: {
        enabled: true,
        drain: async () => {},
        probe: async () => ({ok: true, bootMs: 0, durationMs: 0}),
        runtimes: ['ts'],
        availability: async () => ({available: true, runtimes: ['ts']}),
        execute: async (request) => {
          const run = Bun.spawnSync(['bun', '-e', request.code], {
            cwd: path.join(request.stateDir, 'memory'),
            env: {...process.env, ...request.env},
          })
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
    }
    const document = (url: string, metadata: Record<string, unknown>, content: unknown[] = []) => ({
      type: 'document',
      id: unpackHmId(url),
      document: {
        content,
        metadata,
        version: 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        genesis: 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        account: owner,
        authors: [owner],
        path: '',
        createTime: '',
        updateTime: '',
        visibility: 'PUBLIC',
      },
    })
    const tool = {name: 'greet', type: 'hm://hyper.media/tool', code: 'ipfs://bafygreet'}
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.includes('/ipfs/bafygreet/index.ts')) return new Response(published)
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/GetCID')) return Response.json(serialize({value: needsToken}))
      if (!href.includes('/api/Resource')) throw new Error(`Unexpected fetch: ${href}`)
      // The tool on its own holds its config and names no server: it runs where its writer asks.
      if (href.includes('/tools/greet'))
        return Response.json(serialize(document(toolUrl, {...tool, publicConfig: {units: 'metric'}})))
      // Its parent is an ordinary document, which lists nothing.
      if (href.includes('/tools')) return Response.json(serialize(document(`hm://${owner}/tools`, {name: 'Tools'})))
      if (href.includes('/app/inner'))
        return Response.json(serialize(document(innerUrl, {...tool, privateConfigSchema: `ipfs://${SCHEMA_CID}`})))
      return Response.json(
        serialize(
          document(appUrl, {name: 'App', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER}, [
            {block: {id: 'inner', type: 'Embed', link: innerUrl, attributes: {view: 'Card'}}, children: []},
          ]),
        ),
      )
    }) as unknown as typeof fetch
    try {
      const call = (caller: string, appId: string | undefined, toolId: string) =>
        appRunning.callAppTool(deps, caller, {...(appId ? {appId} : {}), toolId, input: {name: 'Ada'}})

      // There is nothing to turn on: whoever can write the tool's space runs it, and nobody else can.
      const first = await call(owner, toolUrl, toolUrl)
      expect(first.error).toBeUndefined()
      expect(first.output).toMatchObject({greeting: 'hi Ada', key: null, app: toolUrl, units: 'metric'})
      await expect(call(stranger, toolUrl, toolUrl)).rejects.toThrow('only someone who can write its space')
      await expect(call(stranger, undefined, toolUrl)).rejects.toThrow('Add it to an app or an agent')

      // Its secrets are given to the server by a writer, and reach only the writers' own runs.
      await expect(appRunning.runApp(deps, stranger, {appId: toolUrl})).rejects.toThrow('Only someone who can write')
      await appRunning.runApp(deps, owner, {appId: toolUrl, privateConfig: {token: 't0k'}})
      const named = await call(owner, toolUrl, toolUrl)
      expect(named.output).toMatchObject({key: 't0k', app: toolUrl})
      expect(named.appId).toBe(toolUrl)
      // The server finds the host when the caller names none.
      expect((await call(owner, undefined, toolUrl)).output).toEqual(named.output)
      await expect(call(stranger, toolUrl, toolUrl)).rejects.toThrow('only someone who can write its space')
      expect(appRunning.listAppToolCalls(deps, {toolId: toolUrl})).toHaveLength(3)

      // A tool that an app lists belongs to the app: it runs with the app, for every caller.
      await expect(appRunning.runApp(deps, owner, {appId: innerUrl})).rejects.toThrow('run that instead')
      await expect(call(stranger, innerUrl, innerUrl)).rejects.toThrow('call it there')
      // The app holds the secrets. The tool says which it needs, and the app must have them.
      await appRunning.runApp(deps, owner, {appId: appUrl, privateConfig: {other: 'app-other'}})
      const lacking = await call(stranger, undefined, innerUrl)
      expect(lacking.error).toContain('This tool needs private config its app does not have')
      expect(lacking.error).toContain('token')
      await appRunning.runApp(deps, owner, {appId: appUrl, privateConfig: {token: 'app-token'}})
      const inner = await call(stranger, undefined, innerUrl)
      expect(inner.appId).toBe(appUrl)
      // It gets the secret it named, and none of the app's others.
      expect(inner.output).toMatchObject({greeting: 'hi Ada', key: 'app-token', app: appUrl, secrets: ['token']})

      // A draft: code that is not published runs with the tool's config, for a writer of its space only.
      const draft = `export default async function (input: {name: string}, ctx: any) {
  console.log('checking', input.name)
  return {greeting: 'hello ' + input.name, key: ctx.privateConfig.token ?? null}
}
`
      await expect(
        appRunning.testAppTool(deps, stranger, {toolId: toolUrl, source: draft, input: {name: 'Ada'}}),
      ).rejects.toThrow('unpublished code')
      const tested = await appRunning.testAppTool(deps, owner, {toolId: toolUrl, source: draft, input: {name: 'Ada'}})
      expect(tested).toMatchObject({output: {greeting: 'hello Ada', key: 't0k'}, logs: 'checking Ada'})
      expect(tested.error).toBeUndefined()
      // A test run is not a call: nothing is recorded, and the published code is unchanged.
      expect(appRunning.listAppToolCalls(deps, {toolId: toolUrl})).toHaveLength(3)
      expect((await call(owner, toolUrl, toolUrl)).output).toMatchObject({greeting: 'hi Ada'})

      // A draft that fails says why; one that is not a tool is refused before it runs.
      const failing = await appRunning.testAppTool(deps, owner, {
        toolId: toolUrl,
        source: `export default async function () { throw new Error('the draft broke') }`,
        input: {},
      })
      expect(failing.output).toBeUndefined()
      expect(failing.error).toContain('the draft broke')
      const noExport = await appRunning.testAppTool(deps, owner, {
        toolId: toolUrl,
        source: 'export const notDefault = 1',
        input: {},
      })
      expect(noExport.error).toContain('default-export')
      await expect(appRunning.testAppTool(deps, owner, {toolId: toolUrl, source: ' ', input: {}})).rejects.toThrow(
        'no code to run',
      )

      // A draft's own public config is used when it is sent, and the published one otherwise.
      const units = `export default async function (_input: unknown, ctx: any) { return {units: ctx.publicConfig.units} }`
      expect((await appRunning.testAppTool(deps, owner, {toolId: toolUrl, source: units, input: {}})).output).toEqual({
        units: 'metric',
      })
      expect(
        (
          await appRunning.testAppTool(deps, owner, {
            toolId: toolUrl,
            source: units,
            publicConfig: {units: 'imperial'},
            input: {},
          })
        ).output,
      ).toEqual({units: 'imperial'})

      // A server runs only what it is set to. With apps off, a tool on its own still runs, and an
      // app and its tools are refused; with tools off it is the other way round.
      const toolsOnly = {...deps, features: ['tools'] as const}
      expect((await appRunning.callAppTool(toolsOnly, owner, {toolId: toolUrl, input: {name: 'Ada'}})).error).toBe(
        undefined,
      )
      await appRunning.testAppTool(toolsOnly, owner, {toolId: toolUrl, source: draft, input: {name: 'Ada'}})
      await expect(
        appRunning.callAppTool(toolsOnly, stranger, {toolId: innerUrl, input: {name: 'Ada'}}),
      ).rejects.toThrow('does not run apps')
      await expect(
        appRunning.testAppTool(toolsOnly, owner, {appId: appUrl, toolId: innerUrl, source: draft, input: {}}),
      ).rejects.toThrow('does not run apps')
      await expect(appRunning.runApp(toolsOnly, owner, {appId: appUrl})).rejects.toThrow('does not run apps')
      const appsOnly = {...deps, features: ['apps'] as const}
      await expect(appRunning.callAppTool(appsOnly, owner, {toolId: toolUrl, input: {name: 'Ada'}})).rejects.toThrow(
        'does not run tools on their own',
      )
      await expect(appRunning.runApp(appsOnly, owner, {appId: toolUrl})).rejects.toThrow(
        'does not run tools on their own',
      )
      expect(
        (await appRunning.callAppTool(appsOnly, stranger, {toolId: innerUrl, input: {name: 'Ada'}})).error,
      ).toBeUndefined()
      // Those calls were recorded like any other: two more of the tool on its own.
      expect(appRunning.listAppToolCalls(deps, {toolId: toolUrl})).toHaveLength(5)

      // Without the secrets, a draft still runs; it then has no private config.
      await appRunning.stopApp(deps, owner, {appId: toolUrl})
      const early = await appRunning.testAppTool(deps, owner, {toolId: toolUrl, source: draft, input: {name: 'Ada'}})
      expect(early.output).toEqual({greeting: 'hello Ada', key: null})
      // A draft of an app's tool runs with the app's config.
      const innerDraft = await appRunning.testAppTool(deps, owner, {
        appId: appUrl,
        toolId: innerUrl,
        source: `export default async function (_input: unknown, ctx: any) { return {app: ctx.app} }`,
        input: {},
      })
      expect(innerDraft.output).toEqual({app: appUrl})
    } finally {
      globalThis.fetch = originalFetch
      cleanup()
    }
  })
})
