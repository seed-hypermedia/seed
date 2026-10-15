import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  listCapabilitiesForDelegate: vi.fn(),
}))

vi.mock('@/client.server', () => ({
  grpcClient: {accessControl: {listCapabilitiesForDelegate: mocks.listCapabilitiesForDelegate}},
}))

import {resolveMemberAccount} from './site-membership.server'

const VAULT_URL = 'http://vault.internal:7777/'
const ADMIN_SECRET = 'vault-admin-secret'

describe('resolveMemberAccount', () => {
  const env = {...process.env}
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    process.env.SEED_VAULT_INTERNAL_URL = VAULT_URL
    process.env.SEED_VAULT_ADMIN_SECRET = ADMIN_SECRET
    mocks.listCapabilitiesForDelegate.mockResolvedValue({capabilities: []})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const name of ['SEED_VAULT_INTERNAL_URL', 'SEED_VAULT_ADMIN_SECRET'] as const) {
      if (env[name] === undefined) delete process.env[name]
      else process.env[name] = env[name]
    }
  })

  it('resolves a delegated session key to the vault account that granted it AGENT', async () => {
    mocks.listCapabilitiesForDelegate.mockResolvedValue({
      capabilities: [
        {account: 'z6MkWriterOnly', role: 2},
        {account: 'z6MkMember', role: 3},
      ],
    })
    fetchMock.mockResolvedValue(new Response(null, {status: 200}))

    await expect(resolveMemberAccount('z6MkSessionKey')).resolves.toBe('z6MkMember')

    expect(mocks.listCapabilitiesForDelegate).toHaveBeenCalledWith(
      expect.objectContaining({delegate: 'z6MkSessionKey'}),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://vault.internal:7777/vault/api/admin/accounts/z6MkMember')
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${ADMIN_SECRET}`)
  })

  it('falls back to the principal itself when it has no delegation', async () => {
    fetchMock.mockResolvedValue(new Response(null, {status: 200}))

    await expect(resolveMemberAccount('z6MkAccountKey')).resolves.toBe('z6MkAccountKey')
    expect(fetchMock.mock.calls[0]![0]).toContain('/vault/api/admin/accounts/z6MkAccountKey')
  })

  it('refuses when the vault does not know the account', async () => {
    mocks.listCapabilitiesForDelegate.mockResolvedValue({capabilities: [{account: 'z6MkStranger', role: 3}]})
    fetchMock.mockResolvedValue(new Response('not found', {status: 404}))

    await expect(resolveMemberAccount('z6MkSessionKey')).resolves.toBeNull()
  })

  it('refuses when the vault cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(resolveMemberAccount('z6MkAccountKey')).resolves.toBeNull()
  })

  it('refuses, without calling anything, when the membership check is not configured', async () => {
    delete process.env.SEED_VAULT_INTERNAL_URL

    await expect(resolveMemberAccount('z6MkAccountKey')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
