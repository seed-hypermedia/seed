import {SITE_BASE_URL} from '@shm/shared/constants'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getInfo: vi.fn(),
  getPeerInfo: vi.fn(),
  getConfig: vi.fn(),
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    daemon: {getInfo: mocks.getInfo},
    networking: {getPeerInfo: mocks.getPeerInfo},
    documents: {getDocument: mocks.getDocument},
  },
}))
vi.mock('@/site-config.server', () => ({getConfig: mocks.getConfig}))
vi.mock('@/server-signing', () => ({getOrCreateServerSignerAccountUid: async () => 'z6MkSigner'}))

import {loader as configLoader} from '../routes/hm.api.config'
import {loader as siteUrlLoader} from '../routes/hm.api.site-url'

const ACCOUNT = 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'

function call(loader: typeof siteUrlLoader, path: string) {
  return loader({request: new Request(`https://acme.org${path}`), params: {}, context: {}} as any) as Promise<Response>
}

describe('/hm/api/site-url', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getConfig.mockResolvedValue({registeredAccountUid: ACCOUNT})
    mocks.getInfo.mockResolvedValue({peerId: '12D3', protocolId: 'p'})
    mocks.getPeerInfo.mockResolvedValue({addrs: []})
  })

  it("answers the hostname next to the home document's siteUrl", async () => {
    mocks.getDocument.mockResolvedValue({metadata: {toJson: () => ({siteUrl: 'https://old.acme.org'})}})
    const res = await call(siteUrlLoader, '/hm/api/site-url')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({hostname: SITE_BASE_URL || null, siteUrl: 'https://old.acme.org'})
    expect(mocks.getDocument).toHaveBeenCalledWith({account: ACCOUNT, path: '', version: undefined})
  })

  it('answers a null siteUrl when the site has no registered space', async () => {
    mocks.getConfig.mockResolvedValue({})
    const res = await call(siteUrlLoader, '/hm/api/site-url')
    expect((await res.json()).siteUrl).toBeNull()
    expect(mocks.getDocument).not.toHaveBeenCalled()
  })

  it('/hm/api/config no longer loads the home document', async () => {
    const res = await call(configLoader, '/hm/api/config')
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('siteUrl')
    expect(mocks.getDocument).not.toHaveBeenCalled()
  })
})
