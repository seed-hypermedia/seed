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
})
