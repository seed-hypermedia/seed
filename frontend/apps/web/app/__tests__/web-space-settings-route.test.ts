import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  loadSiteResource: vi.fn(),
  loadSiteHeaderData: vi.fn(),
}))

vi.mock('@/client-lazy', () => ({
  WebCommenting: () => null,
}))

vi.mock('@/instrumentation.server', () => ({
  createInstrumentationContext: () => ({enabled: false}),
  instrument: (_ctx: unknown, _name: string, fn: () => unknown) => fn(),
  printInstrumentationSummary: vi.fn(),
  setRequestInstrumentationContext: vi.fn(),
}))

vi.mock('@/hypermedia-metadata', () => ({
  createResourceMetadata: vi.fn(),
  metadataToPageMeta: () => [],
}))

vi.mock('@/loaders', () => ({
  GRPCError: class GRPCError extends Error {},
  loadSiteHeaderData: mocks.loadSiteHeaderData,
  loadSiteResource: mocks.loadSiteResource,
  loadWebDraftPlaceholderResource: vi.fn(),
}))

vi.mock('@/site-settings-emails-content', () => ({
  SiteSettingsEmailsScreen: () => null,
}))

vi.mock('@/meta', () => ({
  defaultPageMeta: () => () => [],
}))

vi.mock('@/not-registered', () => ({
  NoSitePage: () => null,
  NotRegisteredPage: () => null,
}))

vi.mock('@/providers', () => ({
  WebSiteProvider: ({children}: {children: unknown}) => children,
}))

vi.mock('@/site-config.server', () => ({
  getConfig: mocks.getConfig,
}))

vi.mock('@/wrapping', () => ({
  unwrap: <T>(value: T) => value,
}))

vi.mock('@/daemon-auth.server', () => ({
  getDaemonAuthToken: async () => null,
  withDaemonAuthToken: (_token: unknown, fn: () => unknown) => fn(),
}))

vi.mock('@/web-feed-page', () => ({
  WebFeedPage: () => null,
}))

vi.mock('@/web-resource-page', () => ({
  WebInspectorPage: () => null,
  WebResourcePage: () => null,
}))

vi.mock('@/wrapping.server', () => ({
  wrapJSON: (data: unknown) => data,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigationState: () => null,
}))

vi.mock('@shm/ui/inspect-ipfs-page', () => ({
  InspectIpfsPage: () => null,
}))

vi.mock('@shm/shared/translation', () => ({
  useTx: () => (key: string, fallback?: string) => fallback || key,
}))

vi.mock('@shm/ui/spinner', () => ({
  Spinner: () => null,
}))

vi.mock('@shm/ui/text', () => ({
  SizableText: ({children}: {children: unknown}) => children,
}))

import {loader} from '../routes/$'

describe('space settings page routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConfig.mockResolvedValue({registeredAccountUid: 'gateway'})
    mocks.loadSiteHeaderData.mockResolvedValue({
      originHomeId: {uid: 'gateway'},
      homeMetadata: {name: 'Gateway'},
      origin: 'https://seed.example',
      siteHost: 'seed.example',
    })
  })
  it.each([
    [':settings', 'gateway', undefined],
    [':settings/identity', 'gateway', 'identity'],
    [':settings/navigation', 'gateway', 'navigation'],
    [':settings/web-domain', 'gateway', 'web-domain'],
    ['hm/owner/:settings', 'owner', undefined],
    ['hm/owner/:settings/identity', 'owner', 'identity'],
    ['hm/owner/:settings/navigation', 'owner', 'navigation'],
    ['hm/owner/:settings/web-domain', 'owner', 'web-domain'],
  ])('loads %s without treating settings as a document path', async (path, siteUid, section) => {
    const result = await loader({params: {'*': path}, request: new Request(`https://seed.example/${path}`)})
    expect(result).toMatchObject({kind: 'site-settings', siteUid, section, originHomeId: {uid: 'gateway'}})
    expect(mocks.loadSiteResource).not.toHaveBeenCalled()
  })
  it.each([
    ':settings/bogus',
    ':settings/web-domain/not-a-domain',
    ':settings/web-domain/evil%2Fpath.example.com',
    ':settings/web-domain/www.example.com/extra',
    ':settings/identity/extra',
    'hm/owner/:settings/bogus',
    'hm/owner/:settings/email-subscribers/extra',
  ])('rejects an unknown settings destination %s', async (path) => {
    await expect(
      loader({params: {'*': path}, request: new Request(`https://seed.example/${path}`)}),
    ).rejects.toMatchObject({status: 404})
    expect(mocks.loadSiteResource).not.toHaveBeenCalled()
  })
  it.each([':settings/email-subscribers', 'hm/owner/:settings/email-subscribers'])(
    'preserves existing email subscriber route %s',
    async (path) => {
      const result = await loader({params: {'*': path}, request: new Request(`https://seed.example/${path}`)})
      expect(result).toMatchObject({
        kind: 'site-settings-emails',
        siteAccountUid: path.startsWith('hm/') ? 'owner' : 'gateway',
      })
    },
  )
})

it.each([':settings/web-domain/www.example.com', 'hm/owner/:settings/web-domain/www.example.com'])(
  'restores a domain deep link on a fresh request: %s',
  async (path) => {
    mocks.getConfig.mockResolvedValue({registeredAccountUid: 'gateway'})
    mocks.loadSiteHeaderData.mockResolvedValue({originHomeId: {uid: 'gateway'}})
    for (let reload = 0; reload < 2; reload++) {
      const result = await loader({params: {'*': path}, request: new Request(`https://seed.example/${path}`)})
      expect(result).toMatchObject({
        kind: 'site-settings',
        siteUid: path.startsWith('hm/') ? 'owner' : 'gateway',
        section: 'web-domain',
        domain: 'www.example.com',
      })
    }
  },
)
