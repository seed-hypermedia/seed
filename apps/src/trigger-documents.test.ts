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
    // The whole trigger is in the document's metadata, its sets stored as maps.
    expect(created).toEqual({
      metadata: {
        type: 'hm://hyper.media/trigger',
        source: {type: 'webhook'},
        tool: 'hm://z6Mkspace/app/say',
        input: {text: '$event.payload.text'},
      },
      blobs: [],
    })
    const weekly = await apisvc.resolveWriteTrigger(
      {source: {type: 'schedule', schedule: {kind: 'weekly', daysOfWeek: [1, 5], timeOfDay: '09:00', timezone: 'UTC'}}},
      false,
    )
    expect(weekly.metadata.source).toMatchObject({schedule: {daysOfWeek: {mon: true, fri: true}}})
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

  test('document writes store a map one key per entry, replacing it exactly; a list stays one value', () => {
    expect(
      apisvc.metadataToWriteSetAttributes({
        name: 'Recipe',
        tags: {dinner: true, quick: true},
        steps: ['chop', 'fry'],
        empty: {},
        gone: null,
      } as never),
    ).toEqual<unknown>([
      {
        type: 'SetAttributes',
        attrs: [
          {key: ['name'], value: 'Recipe'},
          {key: ['tags'], value: null},
          {key: ['tags', 'dinner'], value: true},
          {key: ['tags', 'quick'], value: true},
          {key: ['steps'], value: ['chop', 'fry']},
          {key: ['empty'], value: null},
          {key: ['gone'], value: null},
        ],
      },
    ])
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
                source: {type: 'webhook'},
                tool: toolUrl,
                input: {text: '$event.payload.message'},
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

  test("an agent's trigger starts its session; an app's trigger must call one of the app's tools", async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-app-agent-trigger-test-'))
    const originalFetch = globalThis.fetch
    const owner = blobs.generateNobleKeyPair()
    const space = blobs.principalToString(owner.principal)
    const appUrl = `hm://${space}/recipes`
    const agentUrl = `hm://${space}/maple`
    const trigger = (url: string) =>
      document(
        url,
        {
          name: url.split('/').at(-1),
          type: 'hm://hyper.media/trigger',
          source: {type: 'schedule', schedule: {kind: 'interval', every: 1, unit: 'hours'}},
        },
        message,
      )
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
        return signerOf(owner)
      }
      if (href.includes('/api/Resource')) {
        if (href.includes('/maple/shopping')) return Response.json(serialize(trigger(`${agentUrl}/shopping`)))
        if (href.includes('/recipes/no-tool')) return Response.json(serialize(trigger(`${appUrl}/no-tool`)))
        if (href.includes('/maple'))
          return Response.json(
            serialize(
              document(agentUrl, {name: 'Maple', type: 'hm://hyper.media/agent'}, [card('b1', `${agentUrl}/shopping`)]),
            ),
          )
        if (href.includes('/recipes'))
          return Response.json(
            serialize(
              document(appUrl, {name: 'Recipes', type: 'hm://hyper.media/app', appEnvironmentUrl: SERVER}, [
                card('b1', `${appUrl}/no-tool`),
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

      // An app's trigger without a tool has nothing to run: it is listed as unusable.
      const app = await send(owner, {_: 'ListHostTriggers', hostId: appUrl})
      expect(app.triggers).toHaveLength(0)
      expect(app.errors[0].error).toContain("calls one of the app's tools")

      // The agent's own trigger is a session trigger of the agent.
      const listed = await send(owner, {_: 'ListHostTriggers', hostId: agentUrl})
      expect(listed.triggers).toHaveLength(1)
      expect(listed.triggers[0].trigger).toMatchObject({agentId: agentUrl, documentId: `${agentUrl}/shopping`})
      expect(listed.triggers[0].trigger.appId).toBeUndefined()

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

      // A firing left with a session but no run (the server stopped while it waited) starts on recovery.
      const waiting = await send(owner, {_: 'CreateSession', agentId: agentUrl})
      db.run(
        `INSERT INTO trigger_firings (id, account_id, agent_id, app_id, trigger_id, activity_key, activity_cbor, status, created_at, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`,
        [
          'left-waiting',
          space,
          agentUrl,
          null,
          listed.triggers[0].trigger.id,
          'manual:left-waiting',
          cbor.encode({type: 'schedule', scheduleKind: 'interval', scheduledAt: Date.now(), firedAt: Date.now()}),
          Date.now(),
          waiting.sessionId,
        ],
      )
      // The earlier firing's run (never started here: model runs are off) holds the trigger's lane.
      db.run(`UPDATE runs SET status = 'failed' WHERE session_id = ?`, [ran.firing.sessionId])
      expect(svc.recoverWaitingFirings()).toBe(1)
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (db.query(`SELECT id FROM runs WHERE id = 'firing-left-waiting'`).get()) break
        await Bun.sleep(20)
      }
      expect(db.query(`SELECT id FROM runs WHERE id = 'firing-left-waiting'`).get()).not.toBeNull()
      // Once it has its run, it is not started again.
      expect(svc.recoverWaitingFirings()).toBe(0)
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
