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
import {principalToUid} from '@/trigger-documents'
import * as cbor from '@/cbor'

const SERVER = 'http://this-server.test/hm/api/apps'
const TOOL_SOURCE = `export default async function (input: {text: string}) {
  return {echoed: input.text}
}
`
const VERSION = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

describe('trigger documents', () => {
  test('an agent writes a trigger with options.trigger, and an update changes only what it names', async () => {
    const created = await apisvc.resolveWriteTrigger(
      {source: {type: 'webhook'}, tool: 'hm://z6Mkspace/app/say', input: {text: '$event.payload.text'}},
      false,
    )
    expect(created.metadata).toMatchObject({
      type: 'hm://hyper.media/trigger',
      source: expect.stringMatching(/^ipfs:\/\//),
      tool: 'hm://z6Mkspace/app/say',
      input: expect.stringMatching(/^ipfs:\/\//),
    })
    expect(created.blobs).toHaveLength(2)
    // Creating needs a source; turning one off does not.
    await expect(apisvc.resolveWriteTrigger({tool: 'hm://z6Mkspace/app/say'}, false)).rejects.toThrow()
    const off = await apisvc.resolveWriteTrigger({enabled: false}, true)
    expect(off).toEqual({metadata: {type: 'hm://hyper.media/trigger', enabled: false}, blobs: []})
    // tool: null makes an agent's trigger start a session again.
    expect((await apisvc.resolveWriteTrigger({tool: null}, true)).metadata).toEqual({
      type: 'hm://hyper.media/trigger',
      tool: null,
    })
  })

  test('principals decode from dag-json bytes', () => {
    const key = blobs.generateNobleKeyPair()
    const bytes = new Uint8Array(key.principal)
    expect(principalToUid({'/': {bytes: Buffer.from(bytes).toString('base64')}})).toBe(
      blobs.principalToString(key.principal),
    )
  })

  test("an app's trigger document fires its tool while the app runs, as the trigger's author", async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-trigger-documents-test-'))
    const originalFetch = globalThis.fetch
    const owner = blobs.generateNobleKeyPair()
    const stranger = blobs.generateNobleKeyPair()
    const space = blobs.principalToString(owner.principal)
    const appUrl = `hm://${space}/echo`
    const toolUrl = `hm://${space}/echo/say`
    const triggerUrl = `hm://${space}/echo/on-hook`
    let listsTrigger = true
    const svc = new apisvc.Service(db, dataDir, {
      hmServerUrl: 'https://hm.test',
      runQueue: {maxConcurrentModelRuns: 0},
      codeExecutor: {
        enabled: true,
        drain: async () => {},
        probe: async () => ({ok: true, bootMs: 0, durationMs: 0}),
        runtimes: ['ts'],
        availability: async () => ({available: true, runtimes: ['ts']}),
        execute: async (request) => {
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
        version: VERSION,
        genesis: VERSION,
        account: space,
        authors: [space],
        path: '',
        createTime: '',
        updateTime: '',
        visibility: 'PUBLIC',
      },
    })
    const card = (id: string, link: string) => ({
      block: {id, type: 'Embed', link, attributes: {view: 'Card'}},
      children: [],
    })
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.includes('/ipfs/bafycode/index.ts')) return new Response(TOOL_SOURCE)
      if (href.startsWith('http://this-server.test/hm/api/apps/health')) return Response.json({serverId: svc.serverId})
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/GetCID')) {
        if (href.includes('bafysource')) return Response.json(serialize({value: {type: 'webhook'}}))
        if (href.includes('bafyinput')) return Response.json(serialize({value: {text: '$event.payload.message'}}))
        // The change behind the trigger's version: signed by the space owner.
        return Response.json(
          serialize({value: {signer: {'/': {bytes: Buffer.from(new Uint8Array(owner.principal)).toString('base64')}}}}),
        )
      }
      if (href.includes('/api/Resource')) {
        if (href.includes('/echo/say'))
          return Response.json(
            serialize(document(toolUrl, {name: 'say', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'})),
          )
        if (href.includes('/echo/on-hook'))
          return Response.json(
            serialize(
              document(triggerUrl, {
                name: 'On hook',
                type: 'hm://hyper.media/trigger',
                source: 'ipfs://bafysource',
                tool: toolUrl,
                input: 'ipfs://bafyinput',
              }),
            ),
          )
        if (href.includes('/echo'))
          return Response.json(
            serialize(
              document(appUrl, {name: 'Echo', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER}, [
                card('b1', toolUrl),
                ...(listsTrigger ? [card('b2', triggerUrl)] : []),
              ]),
            ),
          )
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const send = async (key: blobs.NobleKeyPair, action: Record<string, unknown>) => {
      try {
        return (await svc.message(await apisvc.createSignedEnvelope(key, {action: action as never}))) as any
      } catch (error) {
        return {error: error instanceof Error ? error.message : String(error)}
      }
    }
    try {
      // Before the app runs here, its triggers are not active on this server.
      expect(await send(stranger, {_: 'ListHostTriggers', hostId: appUrl})).toMatchObject({active: false, triggers: []})
      expect(await send(owner, {_: 'RunApp', appId: appUrl})).toMatchObject({_: 'AppRunResponse'})

      // Running, the app's trigger document is a trigger: a webhook calling its tool.
      const listed = await send(owner, {_: 'ListHostTriggers', hostId: appUrl})
      expect(listed).toMatchObject({
        active: true,
        errors: [],
        triggers: [
          {
            trigger: {
              appId: appUrl,
              documentId: triggerUrl,
              author: space,
              name: 'On hook',
              source: {type: 'webhook'},
              continuation: {kind: 'tool', tool: toolUrl},
            },
          },
        ],
      })
      const {trigger, webhookSecret} = listed.triggers[0]
      expect(webhookSecret).toBeString()
      // Only writers of the app's space see the secret.
      const strangerView = await send(stranger, {_: 'ListHostTriggers', hostId: appUrl})
      expect(strangerView.triggers[0].webhookSecret).toBeUndefined()
      // The document is the trigger: the server will not edit it.
      expect(await send(owner, {_: 'DeleteAgentTrigger', triggerId: trigger.id})).toMatchObject({
        error: expect.any(String),
      })

      const delivered = svc.fireWebhookTrigger(
        trigger.id,
        webhookSecret,
        'delivery-1',
        new TextEncoder().encode(JSON.stringify({message: 'hello'})),
      )
      expect(delivered.duplicate).toBe(false)
      let firing: any
      for (let attempt = 0; attempt < 100; attempt += 1) {
        firing = (await send(owner, {_: 'ListHostTriggers', hostId: appUrl})).triggers[0].firings[0]
        if (firing?.status === 'succeeded' || firing?.status === 'failed') break
        await Bun.sleep(50)
      }
      const toolCallId = firing.toolCallId
      expect(firing.status).toBe('succeeded')
      expect(toolCallId).toBeString()
      // The call is the app's, recorded as the trigger author's.
      expect(await send(stranger, {_: 'GetAppToolCall', callId: toolCallId})).toMatchObject({
        call: {caller: space, toolId: toolUrl, input: {text: 'hello'}, output: {echoed: 'hello'}},
      })

      // Taking the card out of the app removes the trigger.
      listsTrigger = false
      // Not at once: a trigger just published may not be listed in its host yet.
      expect((await send(owner, {_: 'ListHostTriggers', hostId: appUrl})).triggers).toHaveLength(1)
      db.run(`UPDATE agent_triggers SET updated_at = ?`, [Date.now() - 11 * 60_000])
      expect(await send(owner, {_: 'ListHostTriggers', hostId: appUrl})).toMatchObject({active: true, triggers: []})
    } finally {
      globalThis.fetch = originalFetch
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  })

  test("an app's trigger can name an agent: it lives in the app and starts that agent's session", async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-app-agent-trigger-test-'))
    const originalFetch = globalThis.fetch
    const owner = blobs.generateNobleKeyPair()
    const stranger = blobs.generateNobleKeyPair()
    const space = blobs.principalToString(owner.principal)
    const appUrl = `hm://${space}/recipes`
    const agentUrl = `hm://${space}/maple`
    const triggers: Record<string, {metadata: Record<string, unknown>; version: string}> = {
      shopping: {metadata: {agent: agentUrl}, version: 'bafyownerversion'},
      'by-stranger': {metadata: {agent: agentUrl}, version: 'bafystrangerversion'},
      'unknown-agent': {metadata: {agent: `hm://${space}/nobody`}, version: 'bafyownerversion'},
      both: {metadata: {agent: agentUrl, tool: `hm://${space}/recipes/scale`}, version: 'bafyownerversion'},
    }
    const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.test', runQueue: {maxConcurrentModelRuns: 0}})
    const signerOf = (key: blobs.NobleKeyPair) =>
      Response.json(
        serialize({value: {signer: {'/': {bytes: Buffer.from(new Uint8Array(key.principal)).toString('base64')}}}}),
      )
    const document = (url: string, metadata: Record<string, unknown>, content: unknown[] = [], version = VERSION) => ({
      type: 'document',
      id: unpackHmId(url),
      document: {
        content,
        metadata,
        version,
        genesis: version,
        account: space,
        authors: [space],
        path: '',
        createTime: '',
        updateTime: '',
        visibility: 'PUBLIC',
      },
    })
    const card = (id: string, link: string) => ({
      block: {id, type: 'Embed', link, attributes: {view: 'Card'}},
      children: [],
    })
    const message = [
      {
        block: {id: 'm1', type: 'Paragraph', text: 'Make the shopping list.', annotations: [], attributes: {}},
        children: [],
      },
    ]
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.startsWith('http://this-server.test/hm/api/apps/health')) return Response.json({serverId: svc.serverId})
      if (href.includes('/api/ListCapabilities')) return Response.json(serialize({capabilities: []}))
      if (href.includes('/api/GetCID')) {
        if (href.includes('bafysource'))
          return Response.json(
            serialize({value: {type: 'schedule', schedule: {kind: 'interval', every: 1, unit: 'hours'}}}),
          )
        return href.includes('bafystrangerversion') ? signerOf(stranger) : signerOf(owner)
      }
      if (href.includes('/api/Resource')) {
        for (const [name, trigger] of Object.entries(triggers))
          if (href.includes(`/recipes/${name}`))
            return Response.json(
              serialize(
                document(
                  `${appUrl}/${name}`,
                  {name, type: 'hm://hyper.media/trigger', source: 'ipfs://bafysource', ...trigger.metadata},
                  message,
                  trigger.version,
                ),
              ),
            )
        if (href.includes('/maple'))
          return Response.json(serialize(document(agentUrl, {name: 'Maple', type: 'hm://hyper.media/agent'})))
        if (href.includes('/recipes'))
          return Response.json(
            serialize(
              document(
                appUrl,
                {name: 'Recipes', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER},
                Object.keys(triggers).map((name, index) => card(`b${index}`, `${appUrl}/${name}`)),
              ),
            ),
          )
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const send = async (key: blobs.NobleKeyPair, action: Record<string, unknown>) => {
      try {
        return (await svc.message(await apisvc.createSignedEnvelope(key, {action: action as never}))) as any
      } catch (error) {
        return {error: error instanceof Error ? error.message : String(error)}
      }
    }
    try {
      expect(await send(owner, {_: 'RunApp', appId: appUrl})).toMatchObject({_: 'AppRunResponse'})
      // Maple runs here for the account running the app.
      const now = Date.now()
      db.run(`INSERT OR IGNORE INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, [space, now, now])
      db.run(
        `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          agentUrl,
          space,
          cbor.encode({name: 'Maple', systemPrompt: 'Help.', modelProvider: 'openai', model: 'gpt-test', tools: []}),
          path.join(dataDir, 'maple'),
          'idle',
          now,
          now,
        ],
      )

      const listed = await send(owner, {_: 'ListHostTriggers', hostId: appUrl})
      expect(listed.triggers).toHaveLength(1)
      expect(listed.triggers[0].trigger).toMatchObject({
        appId: appUrl,
        agentId: agentUrl,
        documentId: `${appUrl}/shopping`,
      })
      expect(listed.triggers[0].trigger.continuation).toBeUndefined()
      const errors = Object.fromEntries(
        listed.errors.map((entry: any) => [entry.documentId.split('/').at(-1), entry.error]),
      )
      expect(errors['by-stranger']).toContain("Only the agent's owner")
      expect(errors['unknown-agent']).toContain('does not run on this server')
      expect(errors.both).toContain('both a tool and an agent')

      // The agent's own triggers are its own: syncing the agent leaves the app's trigger alone.
      db.run(`UPDATE agent_triggers SET updated_at = ?`, [Date.now() - 11 * 60_000])
      await svc.syncTriggerDocuments()
      expect(await send(owner, {_: 'ListHostTriggers', hostId: agentUrl})).toMatchObject({triggers: []})
      expect((await send(owner, {_: 'ListHostTriggers', hostId: appUrl})).triggers).toHaveLength(1)

      // Firing it starts a session with Maple.
      const ran = await send(owner, {_: 'RunTriggerNow', triggerId: listed.triggers[0].trigger.id})
      expect(ran.firing.sessionId).toBeString()
      const session = db
        .query<{agent_id: string}, [string]>(`SELECT agent_id FROM sessions WHERE id = ?`)
        .get(ran.firing.sessionId)
      expect(session?.agent_id).toBe(agentUrl)
      // The session's run is enqueued in the background; let it land before the database closes.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const run = db
          .query<{id: string}, [string]>(`SELECT id FROM runs WHERE session_id = ?`)
          .get(ran.firing.sessionId)
        if (run) break
        await Bun.sleep(20)
      }
    } finally {
      globalThis.fetch = originalFetch
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  })
})

describe('reading app records', () => {
  test('whoever can read a tool reads its calls, and a trigger its firings; anything else is refused', async () => {
    const originalFetch = globalThis.fetch
    const space = 'z6MkkF1AtcK1LWMXGVyi9emwRykN9jQGGAzPWCKhMKz3dAS5'
    const toolUrl = `hm://${space}/echo/say`
    const triggerUrl = `hm://${space}/echo/on-hook`
    const doc = (url: string, type: string) => ({
      type: 'document',
      id: unpackHmId(url),
      document: {
        content: [],
        metadata: {type},
        version: VERSION,
        genesis: VERSION,
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
      if (href.includes('/echo/say')) return Response.json(serialize(doc(toolUrl, 'hm://hyper.media/tool')))
      if (href.includes('/echo/on-hook')) return Response.json(serialize(doc(triggerUrl, 'hm://hyper.media/trigger')))
      return Response.json(serialize({type: 'not-found', id: null}))
    }) as unknown as typeof fetch
    const call = {
      id: 'c1',
      appId: `hm://${space}/echo`,
      toolId: toolUrl,
      caller: space,
      input: {text: 'hi'},
      output: {echoed: 'hi'},
      durationMs: 3,
      createdAt: 1_700_000_000_000,
    }
    const context = {
      hmServerUrl: 'https://hm.test',
      appHistory: {
        calls: async () => [call],
        call: async () => call,
        triggerFirings: async () => ({
          active: true,
          firings: [
            {
              id: 'f1',
              status: 'succeeded',
              createdAt: 1,
              activityKey: 'k',
              activitySummary: 'Webhook',
              toolCallId: 'c1',
            },
          ],
        }),
      },
    }
    try {
      const calls = await apisvc.readAppHistory(context, toolUrl, 'calls', undefined)
      expect(calls.markdown).toContain(`read ${toolUrl}/:call/c1`)
      expect(JSON.stringify(calls.calls)).not.toContain('echoed')
      const one = await apisvc.readAppHistory(context, toolUrl, undefined, 'c1')
      expect(one.markdown).toContain('"echoed": "hi"')
      expect((await apisvc.readAppHistory(context, triggerUrl, 'firings', undefined)).firings).toHaveLength(1)
      // A tool's calls are read from the tool; something unreadable shows nothing.
      await expect(apisvc.readAppHistory(context, triggerUrl, 'calls', undefined)).rejects.toThrow('not a tool')
      await expect(apisvc.readAppHistory(context, `hm://${space}/secret`, 'calls', undefined)).rejects.toThrow()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
