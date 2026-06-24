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

  test('GET health advertises web tool capabilities from server config', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const off = getGetHandler(createAPIRoutes(new apisvc.Service(db, dataDir)), '/agents/api/health')
      const offBody = await (await off()).json()
      expect(offBody.status).toBe('ok')
      expect(offBody.webTools).toEqual({search: false, readBrowser: false})

      const on = getGetHandler(
        createAPIRoutes(
          new apisvc.Service(db, dataDir, {
            web: {searxngUrl: 'http://searxng:8080', crawlerUrl: 'http://crawl4ai:11235'},
          }),
        ),
        '/agents/api/health',
      )
      const onBody = await (await on()).json()
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
