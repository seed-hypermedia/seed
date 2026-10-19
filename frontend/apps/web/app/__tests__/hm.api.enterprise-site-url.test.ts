import {decode as cborDecode} from '@ipld/dag-cbor'
import {SITE_BASE_URL} from '@shm/shared/constants'
import {CID} from 'multiformats'
import {sha256} from 'multiformats/hashes/sha2'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  listKeys: vi.fn(),
  signData: vi.fn(),
  storeBlobs: vi.fn(),
  getDocument: vi.fn(),
  listDocumentChanges: vi.fn(),
  getConfig: vi.fn(),
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    daemon: {listKeys: mocks.listKeys, signData: mocks.signData, storeBlobs: mocks.storeBlobs},
    documents: {getDocument: mocks.getDocument, listDocumentChanges: mocks.listDocumentChanges},
  },
}))
vi.mock('@/site-config.server', () => ({getConfig: mocks.getConfig}))

import {action, loader} from '../routes/hm.api.enterprise-site-url'

const SECRET = 'vault-admin-secret-for-tests'
const ACCOUNT = 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'
// Any two distinct, well-formed dag-cbor CIDs; the route parses them.
const DAG_CBOR = 0x71
const GENESIS = CID.create(1, DAG_CBOR, await sha256.digest(new Uint8Array([1]))).toString()
const HEAD = CID.create(1, DAG_CBOR, await sha256.digest(new Uint8Array([2]))).toString()

function call(input: {authorization?: string | null; method?: string} = {}) {
  const headers: Record<string, string> = {}
  const authorization = input.authorization === undefined ? `Bearer ${SECRET}` : input.authorization
  if (authorization) headers.Authorization = authorization
  return action({
    request: new Request('https://new.acme.org/hm/api/enterprise-site-url', {method: input.method ?? 'POST', headers}),
    params: {},
    context: {},
  } as any) as Promise<Response>
}

function homeDocument(siteUrl: string | null) {
  return {
    account: ACCOUNT,
    path: '',
    genesis: GENESIS,
    version: HEAD,
    generationInfo: {genesis: GENESIS, generation: 1700000000000n},
    metadata: {toJson: () => (siteUrl === null ? {name: 'Acme'} : {name: 'Acme', siteUrl})},
  }
}

type StoredBlob = {cid: string; data: Uint8Array}
type Change = {
  type: string
  genesis?: unknown
  deps?: unknown[]
  depth?: number
  body: {ops: Array<{type: string; attrs?: Array<{key: string[]; value: unknown}>}>}
}
type Ref = {type: string; genesisBlob?: unknown; heads?: unknown[]; generation?: unknown}

describe('/hm/api/enterprise-site-url action', () => {
  const originalSecret = process.env.SEED_VAULT_ADMIN_SECRET

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.SEED_VAULT_ADMIN_SECRET = SECRET
    mocks.getConfig.mockResolvedValue({registeredAccountUid: ACCOUNT, sourcePeerId: 'this-daemon'})
    mocks.getDocument.mockResolvedValue(homeDocument('https://old.acme.org'))
    mocks.listDocumentChanges.mockResolvedValue({
      changes: [
        {id: HEAD, deps: [GENESIS]},
        {id: GENESIS, deps: []},
      ],
    })
    mocks.listKeys.mockResolvedValue({
      keys: [
        {name: 'web-signer', accountId: 'z6MkWebSigner', publicKey: ''},
        {name: 'enterprise-owner', accountId: ACCOUNT, publicKey: ACCOUNT},
      ],
    })
    mocks.signData.mockResolvedValue({signature: new Uint8Array(64)})
    mocks.storeBlobs.mockResolvedValue({})
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SEED_VAULT_ADMIN_SECRET
    else process.env.SEED_VAULT_ADMIN_SECRET = originalSecret
  })

  it('is not there at all without the vault admin secret', async () => {
    delete process.env.SEED_VAULT_ADMIN_SECRET
    const response = await call()
    expect(response.status).toBe(404)
    expect(mocks.getConfig).not.toHaveBeenCalled()
  })

  it.each([null, 'Bearer wrong', `Basic ${SECRET}`, SECRET])(
    'refuses %s with 401 before touching anything',
    async (auth) => {
      const response = await call({authorization: auth})
      expect(response.status).toBe(401)
      expect(mocks.getConfig).not.toHaveBeenCalled()
      expect(mocks.storeBlobs).not.toHaveBeenCalled()
    },
  )

  it('answers 409 when the site has no registered space', async () => {
    mocks.getConfig.mockResolvedValue({availableRegistrationSecret: 'setup-secret'})
    const response = await call()
    expect(response.status).toBe(409)
    expect((await response.json()).message).toMatch(/not registered/)
    expect(mocks.getDocument).not.toHaveBeenCalled()
    expect(mocks.storeBlobs).not.toHaveBeenCalled()
  })

  it('republishes the home document with siteUrl = SEED_BASE_URL, signed by the owner key, body untouched', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accountUid: ACCOUNT,
      siteUrl: SITE_BASE_URL,
      changed: true,
      previousSiteUrl: 'https://old.acme.org',
    })

    expect(mocks.getDocument).toHaveBeenCalledWith({account: ACCOUNT, path: '', version: undefined})
    expect(mocks.listDocumentChanges).toHaveBeenCalledWith(
      expect.objectContaining({account: ACCOUNT, path: '', version: HEAD}),
    )
    for (const c of mocks.signData.mock.calls) expect(c[0].signingKeyName).toBe('enterprise-owner')
    expect(mocks.signData).toHaveBeenCalled()

    expect(mocks.storeBlobs).toHaveBeenCalledTimes(1)
    const blobs = mocks.storeBlobs.mock.calls[0]![0].blobs as StoredBlob[]
    expect(blobs).toHaveLength(2)
    const change = cborDecode<Change>(blobs[0]!.data)
    expect(change.type).toBe('Change')
    expect(String(change.genesis)).toBe(GENESIS)
    expect((change.deps ?? []).map(String)).toEqual([HEAD])
    expect(change.depth).toBe(2)
    expect(change.body.ops).toEqual([{type: 'SetAttributes', attrs: [{key: ['siteUrl'], value: SITE_BASE_URL}]}])
    const ref = cborDecode<Ref>(blobs[1]!.data)
    expect(ref.type).toBe('Ref')
    expect(String(ref.genesisBlob)).toBe(GENESIS)
    expect((ref.heads ?? []).map(String)).toEqual([blobs[0]!.cid])
    // Stays in the document's generation.
    expect(Number(ref.generation)).toBe(1700000000000)
  })

  it('changes nothing when the home document already carries this siteUrl', async () => {
    mocks.getDocument.mockResolvedValue(homeDocument(SITE_BASE_URL))
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accountUid: ACCOUNT,
      siteUrl: SITE_BASE_URL,
      changed: false,
      previousSiteUrl: SITE_BASE_URL,
    })
    expect(mocks.listDocumentChanges).not.toHaveBeenCalled()
    expect(mocks.signData).not.toHaveBeenCalled()
    expect(mocks.storeBlobs).not.toHaveBeenCalled()
  })

  it('sets siteUrl on a home document that never had one', async () => {
    mocks.getDocument.mockResolvedValue(homeDocument(null))
    const response = await call()
    expect(response.status).toBe(200)
    expect((await response.json()).previousSiteUrl).toBeNull()
    expect(mocks.storeBlobs).toHaveBeenCalledTimes(1)
  })

  it('signs with the relabelled owner key when the first attempt left the plain label behind', async () => {
    mocks.listKeys.mockResolvedValue({
      keys: [
        {name: 'enterprise-owner', accountId: 'z6MkStale', publicKey: ''},
        {name: `enterprise-owner-${ACCOUNT.slice(-8)}`, accountId: ACCOUNT, publicKey: ACCOUNT},
      ],
    })
    const response = await call()
    expect(response.status).toBe(200)
    for (const c of mocks.signData.mock.calls) expect(c[0].signingKeyName).toBe(`enterprise-owner-${ACCOUNT.slice(-8)}`)
  })

  it('fails without publishing when the daemon holds no key for the space', async () => {
    mocks.listKeys.mockResolvedValue({keys: [{name: 'web-signer', accountId: 'z6MkWebSigner', publicKey: ''}]})
    const response = await call()
    expect(response.status).toBe(500)
    expect((await response.json()).message).toMatch(/no key for the space/)
    expect(mocks.storeBlobs).not.toHaveBeenCalled()
  })

  it('reports a daemon failure as 500', async () => {
    mocks.storeBlobs.mockRejectedValue(new Error('daemon unavailable'))
    const response = await call()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({message: 'daemon unavailable'})
  })

  it.each(['GET', 'PUT', 'DELETE'])('rejects %s', async (method) => {
    const handler = method === 'GET' ? loader : action
    const response = (await handler({
      request: new Request('https://new.acme.org/hm/api/enterprise-site-url', {method}),
      params: {},
      context: {},
    } as any)) as Response
    expect(response.status).toBe(405)
    expect(mocks.getConfig).not.toHaveBeenCalled()
  })
})
