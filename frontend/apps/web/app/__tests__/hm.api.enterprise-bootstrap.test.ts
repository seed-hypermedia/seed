import {decode as cborDecode} from '@ipld/dag-cbor'
import * as keyfile from '@seed-hypermedia/client/keyfile'
import {SITE_BASE_URL} from '@shm/shared/constants'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  genMnemonic: vi.fn(),
  listKeys: vi.fn(),
  registerKey: vi.fn(),
  signData: vi.fn(),
  storeBlobs: vi.fn(),
  getInfo: vi.fn(),
  getConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    daemon: {
      genMnemonic: mocks.genMnemonic,
      listKeys: mocks.listKeys,
      registerKey: mocks.registerKey,
      signData: mocks.signData,
      storeBlobs: mocks.storeBlobs,
      getInfo: mocks.getInfo,
    },
  },
}))
vi.mock('@/site-config.server', () => ({getConfig: mocks.getConfig, writeConfig: mocks.writeConfig}))

import {action, loader} from '../routes/hm.api.enterprise-bootstrap'

const SECRET = 'vault-admin-secret-for-tests'
// The vector the CLI's key-derivation tests and the daemon agree on.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(
  ' ',
)
const ACCOUNT = 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'

function bootstrap(input: {body?: unknown; authorization?: string | null; method?: string} = {}) {
  const headers: Record<string, string> = {'Content-Type': 'application/json'}
  const authorization = input.authorization === undefined ? `Bearer ${SECRET}` : input.authorization
  if (authorization) headers.Authorization = authorization
  return action({
    request: new Request('https://seed.acme.org/hm/api/enterprise-bootstrap', {
      method: input.method ?? 'POST',
      headers,
      body: input.method === 'GET' ? undefined : input.body === undefined ? '' : JSON.stringify(input.body),
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>
}

type StoredBlob = {cid: string; data: Uint8Array}
type Change = {type: string; body: {ops: Array<{type: string; attrs?: Array<{key: string[]; value: unknown}>}>}}

describe('/hm/api/enterprise-bootstrap action', () => {
  const originalSecret = process.env.SEED_VAULT_ADMIN_SECRET

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.SEED_VAULT_ADMIN_SECRET = SECRET
    mocks.getConfig.mockResolvedValue({availableRegistrationSecret: 'setup-secret'})
    mocks.genMnemonic.mockResolvedValue({mnemonic: MNEMONIC})
    mocks.listKeys.mockResolvedValue({keys: [{name: 'web-signer', accountId: 'z6MkWebSigner', publicKey: ''}]})
    mocks.registerKey.mockResolvedValue({accountId: ACCOUNT, publicKey: ACCOUNT})
    mocks.signData.mockResolvedValue({signature: new Uint8Array(64)})
    mocks.storeBlobs.mockResolvedValue({})
    mocks.getInfo.mockResolvedValue({peerId: 'this-daemon'})
    mocks.writeConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SEED_VAULT_ADMIN_SECRET
    else process.env.SEED_VAULT_ADMIN_SECRET = originalSecret
  })

  it('is not there at all without the vault admin secret', async () => {
    delete process.env.SEED_VAULT_ADMIN_SECRET
    const response = await bootstrap()
    expect(response.status).toBe(404)
    expect(mocks.getConfig).not.toHaveBeenCalled()
    expect(mocks.genMnemonic).not.toHaveBeenCalled()
  })

  it.each([null, 'Bearer wrong', `Basic ${SECRET}`, SECRET])(
    'refuses %s with 401 before touching anything',
    async (auth) => {
      const response = await bootstrap({authorization: auth})
      expect(response.status).toBe(401)
      expect(mocks.getConfig).not.toHaveBeenCalled()
      expect(mocks.genMnemonic).not.toHaveBeenCalled()
      expect(mocks.writeConfig).not.toHaveBeenCalled()
    },
  )

  it('answers 409 with the existing space when the site is already registered', async () => {
    mocks.getConfig.mockResolvedValue({registeredAccountUid: 'z6MkExisting', sourcePeerId: 'this-daemon'})
    const response = await bootstrap({body: {name: 'Acme'}})
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({message: 'This site is already registered', accountUid: 'z6MkExisting'})
    expect(mocks.genMnemonic).not.toHaveBeenCalled()
    expect(mocks.registerKey).not.toHaveBeenCalled()
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })

  it('creates the key, publishes the home document, registers the site and exports the key file', async () => {
    const response = await bootstrap({body: {name: 'Acme'}})
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.accountUid).toBe(ACCOUNT)
    expect(result.name).toBe('Acme')
    expect(result.keyFileName).toBe(`${ACCOUNT}.hmkey.json`)

    // The key the daemon registered is the one the file holds.
    expect(mocks.registerKey).toHaveBeenCalledWith({mnemonic: MNEMONIC, name: 'enterprise-owner'})
    expect(result.keyFile.publicKey).toBe(ACCOUNT)
    expect(result.keyFile.encryption).toBeUndefined()
    expect(result.keyFile.profile).toEqual({name: 'Acme'})
    const loaded = await keyfile.load(JSON.stringify(result.keyFile))
    expect(loaded.publicKey).toBe(ACCOUNT)

    // The daemon signs with that key; the home document goes in as genesis, change, ref.
    expect(mocks.signData).toHaveBeenCalled()
    for (const call of mocks.signData.mock.calls) expect(call[0].signingKeyName).toBe('enterprise-owner')
    expect(mocks.storeBlobs).toHaveBeenCalledTimes(1)
    const blobs = mocks.storeBlobs.mock.calls[0]![0].blobs as StoredBlob[]
    expect(blobs.length).toBeGreaterThanOrEqual(3)
    const change = cborDecode<Change>(blobs[1]!.data)
    expect(change.type).toBe('Change')
    expect(change.body.ops[0]).toEqual({
      type: 'SetAttributes',
      attrs: [
        {key: ['name'], value: 'Acme'},
        {key: ['siteUrl'], value: SITE_BASE_URL},
      ],
    })
    expect(change.body.ops.map((op) => op.type)).toEqual(['SetAttributes', 'ReplaceBlock', 'MoveBlocks'])

    // Registered to itself, after the content exists.
    expect(mocks.writeConfig).toHaveBeenCalledWith('seed.acme.org', {
      registeredAccountUid: ACCOUNT,
      sourcePeerId: 'this-daemon',
    })
    expect(mocks.storeBlobs.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeConfig.mock.invocationCallOrder[0]!)
  })

  it('defaults the name to the hostname and encrypts the key file with the owner password', async () => {
    const response = await bootstrap({body: {ownerPassword: 'hunter2hunter2'}})
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.name).toBe('seed.acme.org')
    expect(result.keyFile.encryption?.kdf).toBe('argon2id')
    expect(result.keyFile.encryption?.cipher).toBe('xchacha20poly1305')
    await expect(keyfile.load(JSON.stringify(result.keyFile))).rejects.toThrow(/password/)
    const loaded = await keyfile.load(JSON.stringify(result.keyFile), 'hunter2hunter2')
    expect(loaded.publicKey).toBe(ACCOUNT)
  })

  it('accepts an empty body', async () => {
    const response = await bootstrap()
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('seed.acme.org')
  })

  it('picks a distinct key label when an earlier attempt left the owner label behind', async () => {
    mocks.listKeys.mockResolvedValue({keys: [{name: 'enterprise-owner', accountId: 'z6MkStale', publicKey: ''}]})
    const response = await bootstrap({body: {name: 'Acme'}})
    expect(response.status).toBe(200)
    const label = `enterprise-owner-${ACCOUNT.slice(-8)}`
    expect(mocks.registerKey).toHaveBeenCalledWith({mnemonic: MNEMONIC, name: label})
    for (const call of mocks.signData.mock.calls) expect(call[0].signingKeyName).toBe(label)
  })

  it('refuses to export a key file that does not match what the daemon registered', async () => {
    mocks.registerKey.mockResolvedValue({accountId: 'z6MkSomethingElse', publicKey: ''})
    const response = await bootstrap()
    expect(response.status).toBe(500)
    expect((await response.json()).message).toMatch(/derived/)
    expect(mocks.storeBlobs).not.toHaveBeenCalled()
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })

  it('does not register the site when publishing the home document fails', async () => {
    mocks.storeBlobs.mockRejectedValue(new Error('daemon unavailable'))
    const response = await bootstrap()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({message: 'daemon unavailable'})
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })

  it('rejects a malformed body without creating a key', async () => {
    const response = await bootstrap({body: {name: ''}})
    expect(response.status).toBe(500)
    expect(mocks.genMnemonic).not.toHaveBeenCalled()
  })

  it.each(['GET', 'PUT', 'DELETE'])('rejects %s', async (method) => {
    const handler = method === 'GET' ? loader : action
    const response = (await handler({
      request: new Request('https://seed.acme.org/hm/api/enterprise-bootstrap', {method}),
      params: {},
      context: {},
    } as any)) as Response
    expect(response.status).toBe(405)
    expect(mocks.getConfig).not.toHaveBeenCalled()
  })
})
