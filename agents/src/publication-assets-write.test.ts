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

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const VERSION = 'bafyreiccaudhs737unopajz7k2tjonmqucburxp45yjzfvvgy75bm66y5q'
const ID = 'hm://z6MkpVa5nMUR5ZaUEyV1SE48KTNbwTuHRd83RwLgMKc4nGU3/test'
const URL = 'https://ipfs.io/ipfs/bafkreihz3ude43b6lilnvunejpnkr4d7sbjwrldflbfffkcg637l7uppbu'
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

test('real writer refuses broken literal image before publish, including dryRun and skipLinkCheck', async () => {
  const ctx = await context()
  let publishes = 0
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('/api/PublishBlobs')) publishes++
    return Response.json(serialize({type: 'not-found', id: unpackHmId(ID)}))
  }) as typeof fetch
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
  }) as typeof fetch
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
  }) as typeof fetch
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
    globalThis.fetch = (async () => Response.json(serialize(data))) as typeof fetch
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
