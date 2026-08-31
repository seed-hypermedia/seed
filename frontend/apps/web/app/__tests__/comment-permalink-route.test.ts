import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  loadSiteResource: vi.fn(),
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
  getMetadata: async (id: unknown) => ({id, metadata: {}}),
  loadSiteHeaderData: vi.fn(),
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

vi.mock('@/web-extension-page', () => ({
  WebExtensionPage: () => null,
}))

vi.mock('@/wrapping.server', () => ({
  wrapJSON: (data: unknown, init?: unknown) => ({data, init}),
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

describe('comment permalink route loading', () => {
  beforeEach(() => {
    mocks.getConfig.mockReset()
    mocks.loadSiteResource.mockReset()
    mocks.getConfig.mockResolvedValue({registeredAccountUid: 'site-account'})
    mocks.loadSiteResource.mockResolvedValue({ok: true})
  })

  it('treats ?v on a comment permalink as the comment version, not the document version', async () => {
    await loader({
      params: {'*': 'hm/doc-account/docs/:comments/comment-author/comment-tsid'},
      request: new Request(
        'https://seed.example/hm/doc-account/docs/:comments/comment-author/comment-tsid?v=comment-version-cid',
      ),
    })

    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
    const [, documentId, extraData] = mocks.loadSiteResource.mock.calls[0]!

    expect(documentId).toMatchObject({
      uid: 'doc-account',
      path: ['docs'],
      version: null,
      latest: true,
    })
    expect(extraData).toMatchObject({
      viewTerm: 'comments',
      openComment: 'comment-author/comment-tsid',
      commentVersion: 'comment-version-cid',
    })
  })

  it('keeps ?v on the document when the URL is not a comment permalink', async () => {
    await loader({
      params: {'*': 'hm/doc-account/docs'},
      request: new Request('https://seed.example/hm/doc-account/docs?v=doc-version-cid'),
    })

    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
    const [, documentId, extraData] = mocks.loadSiteResource.mock.calls[0]!

    expect(documentId).toMatchObject({
      uid: 'doc-account',
      path: ['docs'],
      version: 'doc-version-cid',
      latest: false,
    })
    expect(extraData).toMatchObject({commentVersion: null})
  })

  it('loads a comment permalink without ?v with no comment version', async () => {
    await loader({
      params: {'*': 'hm/doc-account/docs/:comments/comment-author/comment-tsid'},
      request: new Request('https://seed.example/hm/doc-account/docs/:comments/comment-author/comment-tsid'),
    })

    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
    const [, documentId, extraData] = mocks.loadSiteResource.mock.calls[0]!

    expect(documentId).toMatchObject({version: null, latest: true})
    expect(extraData).toMatchObject({
      openComment: 'comment-author/comment-tsid',
      commentVersion: null,
    })
  })
})
