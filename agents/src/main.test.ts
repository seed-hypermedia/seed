import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as cbor from '@/cbor'
import {createAPIRoutes} from '@/main'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('main routes', () => {
  test('POST /api/message and /agents/api/message return CBOR responses', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const routes = createAPIRoutes(new apisvc.Service(db, dataDir))

      for (const route of ['/api/message', '/agents/api/message'] as const) {
        const handler = getPostHandler(routes, route)
        const res = await handler(
          new Request(`http://agents.test${route}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/cbor'},
            body: cbor.encode(await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}})) as BodyInit,
          }) as never,
        )
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('application/cbor')
        const decoded = cbor.decode(await bytes(res))
        expect(decoded).toEqual({_: 'ListAgentsResponse', agents: []})
      }
    } finally {
      db.close()
      cleanup()
    }
  })

  test('POST /api/message rejects wrong content type, malformed CBOR, and invalid signatures', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const routes = createAPIRoutes(new apisvc.Service(db, dataDir))
      const handler = getPostHandler(routes, '/api/message')

      const wrongContentType = await handler(new Request('http://agents.test/api/message', {method: 'POST'}) as never)
      expect(wrongContentType.status).toBe(415)

      const malformed = await handler(
        new Request('http://agents.test/api/message', {
          method: 'POST',
          headers: {'Content-Type': 'application/cbor'},
          body: new Uint8Array([0xff]) as BodyInit,
        }) as never,
      )
      expect(malformed.status).toBe(400)
      const malformedBody = cbor.decode(await bytes(malformed))
      expect(malformedBody).toEqual({_: 'Error', message: 'Invalid CBOR request'})

      const envelope = await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}})
      envelope.sig = new Uint8Array(blobs.ED25519_SIGNATURE_SIZE)
      const invalidSig = await handler(
        new Request('http://agents.test/api/message', {
          method: 'POST',
          headers: {'Content-Type': 'application/cbor'},
          body: cbor.encode(envelope) as BodyInit,
        }) as never,
      )
      expect(invalidSig.status).toBe(401)
    } finally {
      db.close()
      cleanup()
    }
  })

  test('POST /api/message rejects signed actions outside the timestamp window', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const routes = createAPIRoutes(new apisvc.Service(db, dataDir))
      const handler = getPostHandler(routes, '/api/message')
      const envelope = await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}, ts: Date.now() - 31_000})

      const res = await handler(
        new Request('http://agents.test/api/message', {
          method: 'POST',
          headers: {'Content-Type': 'application/cbor'},
          body: cbor.encode(envelope) as BodyInit,
        }) as never,
      )

      expect(res.status).toBe(401)
      expect(cbor.decode<unknown>(await bytes(res))).toEqual({
        _: 'Error',
        message: 'Action timestamp is outside allowed window',
      })
    } finally {
      db.close()
      cleanup()
    }
  })

  test('GET health advertises server endpoints and web tool capabilities', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const off = getGetHandler(createAPIRoutes(new apisvc.Service(db, dataDir)), '/agents/api/health')
      const offBody = await (await off()).json()
      expect(offBody.status).toBe('ok')
      expect(offBody.hmServerUrl).toBe('https://hyper.media')
      expect(offBody.ipfsServerUrl).toBe('https://hyper.media')
      expect(offBody.webTools).toEqual({search: false, readBrowser: false})

      const on = getGetHandler(
        createAPIRoutes(
          new apisvc.Service(db, dataDir, {
            hmServerUrl: 'http://localhost:58004',
            ipfsServerUrl: 'http://localhost:58001',
            web: {searxngUrl: 'http://searxng:8080', crawlerUrl: 'http://crawl4ai:11235'},
          }),
        ),
        '/agents/api/health',
      )
      const onBody = await (await on()).json()
      expect(onBody.hmServerUrl).toBe('http://localhost:58004')
      expect(onBody.ipfsServerUrl).toBe('http://localhost:58001')
      expect(onBody.webTools).toEqual({search: true, readBrowser: true})

      const searchOnly = getGetHandler(
        createAPIRoutes(new apisvc.Service(db, dataDir, {web: {searxngUrl: 'http://searxng:8080'}})),
        '/agents/api/health',
      )
      const searchOnlyBody = await (await searchOnly()).json()
      expect(searchOnlyBody.webTools).toEqual({search: true, readBrowser: false})
    } finally {
      db.close()
      cleanup()
    }
  })

  test('webhook endpoint authenticates, limits, deduplicates, and fires only its trigger', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const svc = new apisvc.Service(db, dataDir)
    try {
      const account = blobs.generateNobleKeyPair()
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}},
        }),
      )
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Webhook Agent', systemPrompt: 'Test.', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      // Keep the monitor assertion focused on the webhook source rather than the default mention trigger.
      db.run(`UPDATE agent_triggers SET enabled = 0 WHERE agent_id = ?`, [createdAgent.agentId])

      const createAction = {
        _: 'CreateAgentTrigger' as const,
        agentId: createdAgent.agentId,
        clientRequestId: 'webhook-create-1',
        trigger: {name: 'Inbound', prompt: 'Process payload.', source: {type: 'webhook' as const}},
      }
      const created = await svc.message(await apisvc.createSignedEnvelope(account, {action: createAction}))
      if (created._ !== 'CreateAgentTriggerResponse' || !created.webhookSecret) throw new Error('unexpected response')
      expect(created.webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const retried = await svc.message(await apisvc.createSignedEnvelope(account, {action: createAction}))
      expect(retried).toEqual(created)

      const listed = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ListAgentTriggers', agentId: createdAgent.agentId},
        }),
      )
      expect(JSON.stringify(listed)).not.toContain(created.webhookSecret)
      const credential = db
        .query<{secret_hash: Uint8Array}, [string]>(
          `SELECT secret_hash FROM webhook_trigger_credentials WHERE trigger_id = ?`,
        )
        .get(created.trigger.id)
      expect(credential?.secret_hash.byteLength).toBe(32)
      expect(credential && new TextDecoder().decode(credential.secret_hash)).not.toContain(created.webhookSecret)

      const routes = createAPIRoutes(svc)
      const handler = getPostHandler(routes, '/agents/api/webhooks/:triggerId')
      const deliver = (
        body: string,
        key = 'delivery-1',
        secret = created.webhookSecret!,
        triggerId = created.trigger.id,
      ) => {
        const req = new Request(`http://agents.test/agents/api/webhooks/${triggerId}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': 'application/json; charset=utf-8',
            'idempotency-key': key,
          },
          body,
        })
        Object.defineProperty(req, 'params', {value: {triggerId}})
        return handler(req as never)
      }

      const accepted = await deliver('{"message":"hello"}')
      expect(accepted.status).toBe(202)
      const acceptedBody = await accepted.json()
      expect(acceptedBody).toMatchObject({accepted: true, duplicate: false})
      expect(acceptedBody).toEqual({accepted: true, duplicate: false})
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM sessions`).get()?.count).toBe(1)
      const firing = db
        .query<{activity_cbor: Uint8Array}, [string]>(`SELECT activity_cbor FROM trigger_firings WHERE trigger_id = ?`)
        .get(created.trigger.id)
      expect(firing && cbor.decode(firing.activity_cbor)).toEqual({
        type: 'webhook',
        feedEventId: 'webhook:delivery-1',
        deliveryKey: 'delivery-1',
        idempotencyKey: 'delivery-1',
        payload: {message: 'hello'},
      })

      const duplicate = await deliver('{"message":"hello"}')
      expect(duplicate.status).toBe(202)
      expect(await duplicate.json()).toEqual({accepted: true, duplicate: true})
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM sessions`).get()?.count).toBe(1)

      const conflict = await deliver('{"message":"changed"}')
      expect(conflict.status).toBe(409)
      const malformed = await deliver('{', 'delivery-malformed')
      expect(malformed.status).toBe(400)
      const invalidKey = await deliver('{}', 'contains spaces')
      expect(invalidKey.status).toBe(400)
      const compressedReq = new Request(`http://agents.test/agents/api/webhooks/${created.trigger.id}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${created.webhookSecret}`,
          'content-encoding': 'gzip',
          'content-type': 'application/json',
          'idempotency-key': 'delivery-compressed',
        },
        body: '{}',
      })
      Object.defineProperty(compressedReq, 'params', {value: {triggerId: created.trigger.id}})
      expect((await handler(compressedReq as never)).status).toBe(415)
      const oversized = await deliver(JSON.stringify({data: 'x'.repeat(apisvc.WEBHOOK_MAX_BODY_BYTES)}), 'delivery-big')
      expect(oversized.status).toBe(413)

      const wrongAuth = await deliver('{}', 'delivery-auth', 'x'.repeat(43))
      const unknown = await deliver('{}', 'delivery-auth', 'x'.repeat(43), crypto.randomUUID())
      expect(wrongAuth.status).toBe(401)
      expect(unknown.status).toBe(401)
      expect(await wrongAuth.json()).toEqual(await unknown.json())

      const monitorResult = await svc.processActivityEvent(created.trigger.account, {
        type: 'comment',
        id: 'activity-that-must-not-fire-webhook',
      })
      expect(monitorResult.checked).toBe(0)
      expect(
        db
          .query<{count: number}, [string]>(`SELECT count(*) AS count FROM trigger_firings WHERE trigger_id = ?`)
          .get(created.trigger.id)?.count,
      ).toBe(1)

      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'UpdateAgentTrigger', triggerId: created.trigger.id, patch: {enabled: false}},
        }),
      )
      const disabled = await deliver('{}', 'delivery-disabled')
      expect(disabled.status).toBe(401)
      expect(await disabled.json()).toEqual({error: 'Invalid webhook credentials'})
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'UpdateAgentTrigger',
              triggerId: created.trigger.id,
              patch: {source: {type: 'site-update', resourcePrefix: 'hm://example'}},
            },
          }),
        ),
      ).rejects.toMatchObject({status: 400})
      await svc.drainTriggerSessions()
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'DeleteAgentTrigger', triggerId: created.trigger.id},
        }),
      )
      expect(
        db
          .query<{count: number}, [string]>(
            `SELECT count(*) AS count FROM webhook_trigger_credentials WHERE trigger_id = ?`,
          )
          .get(created.trigger.id)?.count,
      ).toBe(0)
    } finally {
      svc.stopRunQueue()
      db.close()
      cleanup()
    }
  })
})

function createTestState(): {db: Database; dataDir: string; cleanup: () => void} {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-route-test-'))
  return {db, dataDir, cleanup: () => fs.rmSync(dataDir, {recursive: true, force: true})}
}

function getPostHandler(
  routes: Bun.Serve.Routes<undefined, string>,
  route: string,
): (req: Request) => Promise<Response> {
  const entry = routes[route] as {POST?: (req: Request) => Promise<Response>} | undefined
  if (!entry?.POST) throw new Error(`missing route ${route}`)
  return entry.POST
}

function getGetHandler(routes: Bun.Serve.Routes<undefined, string>, route: string): () => Response | Promise<Response> {
  const entry = routes[route] as {GET?: () => Response | Promise<Response>} | undefined
  if (!entry?.GET) throw new Error(`missing route ${route}`)
  return entry.GET
}

async function bytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer())
}
