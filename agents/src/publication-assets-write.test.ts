import {afterEach, expect, spyOn, test} from 'bun:test'
import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import {serialize} from 'superjson'
import * as blobs from '@shm/shared/blobs'
import {createSeedClient, unpackHmId} from '@seed-hypermedia/client'
import * as api from './api-service'
import * as sqlite from './sqlite'
import * as media from './publication-assets'
import * as cbor from './cbor'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const VERSION = 'bafyreiccaudhs737unopajz7k2tjonmqucburxp45yjzfvvgy75bm66y5q'
const ID = 'hm://z6MkpVa5nMUR5ZaUEyV1SE48KTNbwTuHRd83RwLgMKc4nGU3/test'
const CID = 'bafkreihz3ude43b6lilnvunejpnkr4d7sbjwrldflbfffkcg637l7uppbu'
const URL = `https://hyper.media/ipfs/${CID}?fixture=unavailable`
const originalFetch = globalThis.fetch
const cleanup: (() => void)[] = []
afterEach(() => {
  globalThis.fetch = originalFetch
  while (cleanup.length) cleanup.pop()!()
})

async function context() {
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  const dir = fs.mkdtempSync(os.tmpdir() + '/asset-write-')
  cleanup.push(() => {
    sqlite.closeDatabase(db)
    fs.rmSync(dir, {recursive: true, force: true})
  })
  const owner = blobs.generateNobleKeyPair()
  const service = new api.Service(db, dir, {hmServerUrl: 'https://hm.test'})
  const imported = await service.message(
    await api.createSignedEnvelope(owner, {action: {_: 'ImportSigningIdentity', seed: owner.seed}}),
  )
  if (imported._ !== 'ImportSigningIdentityResponse') throw Error('unexpected import')
  return {
    db,
    accountId: blobs.principalToString(owner.principal),
    agentId: 'asset-test',
    definition: {signingKeys: [imported.identity.name]},
    hmServerUrl: 'https://hm.test',
    ipfsServerUrl: 'https://hm.test',
    publishEnabled: true,
    stateDir: dir,
  } as api.AgentServicePiToolContext
}
function mockProbe(status = 206) {
  const probe = spyOn(media, 'probePublicAsset').mockResolvedValue({status, contentType: 'image/png', sample: PNG})
  cleanup.push(() => probe.mockRestore())
  return probe
}
function resource(version = VERSION, url = URL) {
  return {
    type: 'document',
    id: unpackHmId(ID),
    document: {
      version,
      account: unpackHmId(ID)!.uid,
      authors: [],
      path: '/test',
      createTime: '',
      updateTime: '',
      genesis: VERSION,
      visibility: 'PUBLIC',
      metadata: {name: 'Test'},
      content: [{block: {id: 'img', type: 'Image', link: url, attributes: {}}, children: []}],
    },
  }
}

test('real writer refuses broken literal image on our server before publish, including dryRun and skipLinkCheck', async () => {
  const ctx = await context()
  let publishes = 0
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/api/PublishBlobs')) publishes++
    return Response.json(serialize({type: 'not-found', id: unpackHmId(ID)}))
  }) as unknown as typeof fetch
  const probe = mockProbe(429)
  for (const dryRun of [true, false])
    await expect(
      api.executeWriteVerb(ctx, {
        address: `hm://${ctx.accountId}/test`,
        content: `![Evidence](${URL})`,
        options: {name: 'Test', skipLinkCheck: true},
        dryRun,
      }),
    ).rejects.toThrow('HTTP 429')
  expect(publishes).toBe(0)
  expect(probe.mock.calls.map((c) => c[0])).toEqual([URL, URL])
})

test('a committed create returns its receipt and explicit unverified state when readback is unavailable', async () => {
  const ctx = await context()
  let publishes = 0
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/api/PublishBlobs')) {
      publishes++
      return Response.json(serialize({cids: [VERSION]}))
    }
    return Response.json(serialize({type: 'not-found', id: unpackHmId(ID)}))
  }) as unknown as typeof fetch
  mockProbe()
  const result = await api.executeWriteVerb(ctx, {
    address: `hm://${ctx.accountId}/test`,
    content: `![Evidence](${URL})`,
    options: {name: 'Test'},
  })
  expect(publishes).toBe(1)
  expect(result).toMatchObject({published: true, cids: [VERSION], assetVerification: {status: 'unverified'}})
  expect(result.version).toBeString()
  expect(result.message).toContain('do not blindly recreate')
})

test('readback requests the committed version and checks its exact parsed URL', async () => {
  const asked: string[] = []
  globalThis.fetch = (async (url: unknown) => {
    asked.push(String(url))
    return Response.json(serialize(resource()))
  }) as unknown as typeof fetch
  const probe = mockProbe()
  const result = await api.readBackDocumentAssets(createSeedClient('https://hm.test'), ID, VERSION, [
    {url: URL, kind: 'Image'},
  ])
  expect(result).toMatchObject({assetVerification: {status: 'verified', version: VERSION}})
  expect(asked[0]).toContain(VERSION)
  expect(probe.mock.calls[0]?.[0]).toBe(URL)
})

test('readback mismatch, changed URL and failing endpoint cannot claim verification', async () => {
  const probe = mockProbe(429)
  for (const data of [resource('another-version'), resource(VERSION, 'https://other.example/image'), resource()]) {
    globalThis.fetch = (async () => Response.json(serialize(data))) as unknown as typeof fetch
    expect(
      await api.readBackDocumentAssets(createSeedClient('https://hm.test'), ID, VERSION, [{url: URL, kind: 'Image'}]),
    ).toMatchObject({published: true, assetVerification: {status: 'unverified'}})
  }
  expect(probe).toHaveBeenCalledTimes(1)
})

test('text-only writes have no media network/readback overhead', async () => {
  const probe = mockProbe()
  expect(await api.readBackDocumentAssets(createSeedClient('https://hm.test'), ID, VERSION, [])).toEqual({})
  expect(probe).not.toHaveBeenCalled()
})

test('bounded readback tolerates temporary indexing lag without claiming an uncommitted version', async () => {
  let reads = 0
  globalThis.fetch = (async () =>
    Response.json(
      serialize(++reads === 1 ? {type: 'not-found', id: unpackHmId(ID)} : resource()),
    )) as unknown as typeof fetch
  mockProbe()
  expect(
    await api.readBackDocumentAssets(createSeedClient('https://hm.test'), ID, VERSION, [{url: URL, kind: 'Image'}]),
  ).toMatchObject({assetVerification: {status: 'verified'}})
  expect(reads).toBe(2)
})

test('updates and metadata-only changes check the resulting body and preserve the old version on failure', async () => {
  const ctx = await context()
  const id = `hm://${ctx.accountId}/test`
  let publishes = 0
  globalThis.fetch = (async (url: unknown) => {
    const href = String(url)
    if (href.includes('/api/PublishBlobs')) {
      publishes++
      return Response.json(serialize({cids: [VERSION]}))
    }
    if (href.includes('/api/ListChanges'))
      return Response.json(serialize({changes: [{id: VERSION, deps: [], author: ctx.accountId}]}))
    return Response.json(
      serialize({...resource(), id: unpackHmId(id), document: {...resource().document, account: ctx.accountId}}),
    )
  }) as unknown as typeof fetch
  mockProbe(429)
  for (const content of [undefined, `![Replacement](${URL})`]) {
    await expect(
      api.executeWriteVerb(ctx, {
        address: id,
        ...(content ? {content} : {}),
        options: {action: 'update', name: 'Renamed'},
      }),
    ).rejects.toThrow('HTTP 429')
  }
  expect(publishes).toBe(0)
})

test('native IPFS preflight is pending; configured local gateway is sampled only after readback', async () => {
  const ctx = await context()
  const native = `ipfs://${CID}`
  let gatewayCalls = 0
  globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
    if (String(url).includes('/ipfs/')) {
      gatewayCalls++
      expect(options?.redirect).toBe('error')
      return new Response(PNG, {headers: {'content-type': 'image/png'}})
    }
    return Response.json(
      serialize(
        String(url).startsWith('http://localhost:3000')
          ? resource(VERSION, native)
          : {type: 'not-found', id: unpackHmId(ID)},
      ),
    )
  }) as unknown as typeof fetch
  const preview = await api.executeWriteVerb(ctx, {
    address: `hm://${ctx.accountId}/test`,
    content: `![Image](${native})`,
    options: {name: 'Test'},
    dryRun: true,
  })
  expect(preview).toMatchObject({assetVerification: {status: 'preflight', assets: [{status: 'pending-publication'}]}})
  expect(gatewayCalls).toBe(0)
  expect(
    await api.readBackDocumentAssets(createSeedClient('http://localhost:3000'), ID, VERSION, [
      {url: native, kind: 'Image'},
    ]),
  ).toMatchObject({assetVerification: {status: 'verified'}})
  expect(gatewayCalls).toBe(1)
})

test('draft publication and its dry run use the same media gate; refusal preserves the draft', async () => {
  const ctx = await context()
  const now = Date.now()
  ctx.db.run(
    'INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [ctx.agentId, ctx.accountId, cbor.encode({}), 'x', 'ready', now, now],
  )
  let publishes = 0
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/api/PublishBlobs')) {
      publishes++
      return Response.json(serialize({cids: [VERSION]}))
    }
    return Response.json(serialize({type: 'not-found', id: unpackHmId(ID)}))
  }) as unknown as typeof fetch
  const created = await api.executeWriteVerb(ctx, {
    address: `hm://${ctx.accountId}`,
    options: {action: 'draft.create', input: {name: 'Draft', path: '/draft', content: `![Image](${URL})`}},
  })
  const probe = mockProbe(429)
  for (const dryRun of [true, false])
    await expect(
      api.executeWriteVerb(ctx, {
        address: `hm://${ctx.accountId}`,
        options: {action: 'draft.publish', input: {draft: created.draftId}},
        dryRun,
      }),
    ).rejects.toThrow('HTTP 429')
  expect(publishes).toBe(0)
  expect(ctx.db.query('SELECT status FROM agent_drafts WHERE id = ?').get(created.draftId as string)).toEqual({
    status: 'idle',
  })
  probe.mockResolvedValue({status: 206, contentType: 'image/png', sample: PNG})
  const result = await api.executeWriteVerb(ctx, {
    address: `hm://${ctx.accountId}`,
    options: {action: 'draft.publish', input: {draft: created.draftId}},
  })
  expect(result).toMatchObject({published: true, draftId: created.draftId, assetVerification: {status: 'unverified'}})
  expect(publishes).toBe(1)
  expect(ctx.db.query('SELECT status FROM agent_drafts WHERE id = ?').get(created.draftId as string)).toEqual({
    status: 'published',
  })
})

test('JSON block validation uses the SDK schema and still rejects malformed blocks', async () => {
  const ctx = await context()
  globalThis.fetch = (async () =>
    Response.json(serialize({type: 'not-found', id: unpackHmId(ID)}))) as unknown as typeof fetch
  const write = (content: unknown) =>
    api.executeWriteVerb(ctx, {
      address: `hm://${ctx.accountId}/json`,
      options: {action: 'document.create', input: {name: 'JSON', format: 'json', content}},
      dryRun: true,
    })
  expect(
    await write([{block: {id: 'p', type: 'Paragraph', text: 'OK', attributes: {}, annotations: []}, children: []}]),
  ).toMatchObject({dryRun: true})
  await expect(write([{block: {id: 42, type: 'Paragraph'}, children: []}])).rejects.toThrow()
})
