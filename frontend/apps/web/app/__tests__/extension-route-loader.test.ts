/**
 * Loader-level tests for extension pages in routes/$.tsx: which paths are
 * served by an installed extension, whose home document the install records
 * are read from (registered site vs. the visited account on gateway paths),
 * and that the home metadata fetched for the check is reused for normal
 * document loads.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest'

const REGISTERED = 'z6MkRegisteredSite'
const FOREIGN = 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getMetadata: vi.fn(),
  loadSiteHeaderData: vi.fn(),
  loadSiteResource: vi.fn(),
}))

vi.mock('@/client-lazy', () => ({WebCommenting: () => null}))
vi.mock('@/instrumentation.server', () => ({
  createInstrumentationContext: () => ({enabled: false}),
  instrument: (_ctx: unknown, _name: string, fn: () => unknown) => fn(),
  printInstrumentationSummary: vi.fn(),
  setRequestInstrumentationContext: vi.fn(),
}))
vi.mock('@/hypermedia-metadata', () => ({createResourceMetadata: vi.fn(), metadataToPageMeta: () => []}))
vi.mock('@/loaders', () => ({
  GRPCError: class GRPCError extends Error {},
  getMetadata: mocks.getMetadata,
  loadSiteHeaderData: mocks.loadSiteHeaderData,
  loadSiteResource: mocks.loadSiteResource,
  loadWebDraftPlaceholderResource: vi.fn(),
}))
vi.mock('@/site-settings-emails-content', () => ({SiteSettingsEmailsScreen: () => null}))
vi.mock('@/meta', () => ({defaultPageMeta: () => () => [], defaultSiteIcon: '/icon.png'}))
vi.mock('@/not-registered', () => ({NoSitePage: () => null, NotRegisteredPage: () => null}))
vi.mock('@/providers', () => ({
  WebSiteProvider: ({children}: {children: unknown}) => children,
  getOptimizedImageUrl: (cid: string) => `/hm/api/image/${cid}`,
}))
vi.mock('@/site-config.server', () => ({getConfig: mocks.getConfig}))
vi.mock('@/wrapping', () => ({unwrap: <T>(value: T) => value}))
vi.mock('@/daemon-auth.server', () => ({
  getDaemonAuthToken: async () => null,
  withDaemonAuthToken: (_token: unknown, fn: () => unknown) => fn(),
}))
vi.mock('@/web-feed-page', () => ({WebFeedPage: () => null}))
vi.mock('@/web-resource-page', () => ({WebInspectorPage: () => null, WebResourcePage: () => null}))
vi.mock('@/web-extension-page', () => ({WebExtensionPage: () => null}))
vi.mock('@/wrapping.server', () => ({wrapJSON: (data: unknown, init?: unknown) => ({data, init})}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigationState: () => null}))
vi.mock('@shm/ui/inspect-ipfs-page', () => ({InspectIpfsPage: () => null}))
vi.mock('@shm/shared/translation', () => ({useTx: () => (key: string, fallback?: string) => fallback || key}))
vi.mock('@shm/ui/spinner', () => ({Spinner: () => null}))
vi.mock('@shm/ui/text', () => ({SizableText: ({children}: {children: unknown}) => children}))

import {loader, meta} from '../routes/$'

const homes: Record<string, Record<string, unknown>> = {
  [REGISTERED]: {name: 'Registered Site', extensions: {docs: {ext: 'hm://z6MkAuthor/docs-ext', title: 'Docs'}}},
  [FOREIGN]: {
    name: 'Foreign Site',
    icon: 'ipfs://bafyIcon',
    extensions: {board: {ext: 'hm://z6MkAuthor/kanban', version: 'bafyBoard', title: 'Board'}},
  },
}

async function run(path: string) {
  return (await loader({
    params: {'*': path.replace(/^\//, '')},
    request: new Request(`https://seed.example${path}`),
  })) as unknown as {data: any; init?: unknown}
}

describe('extension pages in the document route loader', () => {
  beforeEach(() => {
    mocks.getConfig.mockReset()
    mocks.getMetadata.mockReset()
    mocks.loadSiteHeaderData.mockReset()
    mocks.loadSiteResource.mockReset()
    mocks.getConfig.mockResolvedValue({registeredAccountUid: REGISTERED})
    mocks.getMetadata.mockImplementation(async (id: {uid: string}) => ({id, metadata: homes[id.uid] ?? {}}))
    mocks.loadSiteHeaderData.mockImplementation(async (_req: unknown, options?: {siteUid?: string}) => ({
      originHomeId: {uid: REGISTERED, path: [], latest: true},
      homeMetadata: homes[REGISTERED],
      origin: 'https://seed.example',
      siteHost: 'https://seed.example',
      dehydratedState: {prefetchedFor: options?.siteUid},
    }))
    mocks.loadSiteResource.mockResolvedValue({ok: true})
  })

  it('serves a foreign account mount in gateway form from THAT account home document', async () => {
    const {data} = await run(`/hm/${FOREIGN}/board/card/7`)

    // Install records were read from the visited account, not the registered
    // site (whose home is fetched concurrently for the ordinary-document path).
    expect(mocks.getMetadata).toHaveBeenCalledTimes(2)
    expect(mocks.getMetadata.mock.calls.map((call) => call[0].uid).sort()).toEqual([FOREIGN, REGISTERED].sort())
    // The header payload prefetches the visited account's home; originHomeId stays the deployment's site.
    expect(mocks.loadSiteHeaderData).toHaveBeenCalledWith(expect.anything(), {siteUid: FOREIGN})
    expect(mocks.loadSiteResource).not.toHaveBeenCalled()

    expect(data).toMatchObject({
      kind: 'extension',
      originHomeId: {uid: REGISTERED},
      origin: 'https://seed.example',
      id: {uid: FOREIGN, path: ['board', 'card', '7'], latest: true},
      siteHomeMetadata: {name: 'Foreign Site'},
      mount: {
        mountPath: 'board',
        mountSegments: ['board'],
        subPath: ['card', '7'],
        record: {ext: 'hm://z6MkAuthor/kanban', version: 'bafyBoard', title: 'Board'},
      },
    })
    expect(data.mount).not.toHaveProperty('siteUid')

    const tags = meta({data} as any) as Array<Record<string, unknown>>
    expect(tags).toContainEqual({title: 'Board · Foreign Site'})
    expect(tags.find((t) => t.rel === 'icon')?.href).toBe('/hm/api/image/bafyIcon')
  })

  it('does not apply the registered site installs to a foreign account gateway path', async () => {
    await run(`/hm/${FOREIGN}/docs`)

    expect(mocks.loadSiteHeaderData).not.toHaveBeenCalled()
    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
    const [, documentId, extraData] = mocks.loadSiteResource.mock.calls[0]!
    expect(documentId).toMatchObject({uid: FOREIGN, path: ['docs']})
    // The foreign home metadata must not be passed off as the registered site's
    // header data: the registered home (fetched concurrently) is what is reused.
    expect(extraData.homeMetadataPayload).toMatchObject({id: {uid: REGISTERED}, metadata: {name: 'Registered Site'}})
  })

  it('fetches the registered home concurrently with the foreign extension lookup, not after it', async () => {
    const started: string[] = []
    const resolvers: Array<() => void> = []
    mocks.getMetadata.mockImplementation(
      (id: {uid: string}) =>
        new Promise((resolve) => {
          started.push(id.uid)
          resolvers.push(() => resolve({id, metadata: homes[id.uid] ?? {}}))
        }),
    )

    const pending = run(`/hm/${FOREIGN}/docs`)
    // Both home lookups must be in flight before either has resolved (nothing
    // resolves them until we do below, so a serial implementation never
    // reaches two started calls).
    for (let i = 0; i < 20 && started.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(started.sort()).toEqual([FOREIGN, REGISTERED].sort())
    resolvers.forEach((resolve) => resolve())
    await pending

    expect(mocks.getMetadata).toHaveBeenCalledTimes(2)
    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
    expect(mocks.loadSiteResource.mock.calls[0]![2].homeMetadataPayload).toMatchObject({id: {uid: REGISTERED}})
  })

  it('does not prefetch the registered home for foreign paths that are extension pages or need no lookup', async () => {
    await run(`/hm/${FOREIGN}/board`)
    // Extension page: the registered home is still fetched (concurrently) but only two lookups happen in total.
    expect(mocks.getMetadata).toHaveBeenCalledTimes(2)
    expect(mocks.loadSiteResource).not.toHaveBeenCalled()

    mocks.getMetadata.mockClear()
    await run(`/hm/${FOREIGN}`)
    expect(mocks.getMetadata).not.toHaveBeenCalled()
  })

  it('serves a registered site mount on the site origin and in gateway form', async () => {
    const native = await run('/docs/guide')
    expect(native.data).toMatchObject({
      kind: 'extension',
      id: {uid: REGISTERED, path: ['docs', 'guide']},
      mount: {mountPath: 'docs', subPath: ['guide']},
    })
    expect(mocks.loadSiteHeaderData).toHaveBeenLastCalledWith(expect.anything(), {siteUid: REGISTERED})

    const gateway = await run(`/hm/${REGISTERED}/docs`)
    expect(gateway.data).toMatchObject({kind: 'extension', id: {uid: REGISTERED, path: ['docs']}})
    expect(mocks.loadSiteResource).not.toHaveBeenCalled()
  })

  it('shadows document views beneath a mount but not the inspector', async () => {
    const activity = await run('/docs/:activity')
    expect(activity.data).toMatchObject({kind: 'extension', mount: {subPath: []}})

    await run('/inspect/docs')
    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
    expect(mocks.loadSiteResource.mock.calls[0]![2]).toMatchObject({isInspect: true})
  })

  it('reuses the home metadata for ordinary document loads instead of fetching it twice', async () => {
    await run('/about/team')

    expect(mocks.getMetadata).toHaveBeenCalledTimes(1)
    expect(mocks.loadSiteHeaderData).not.toHaveBeenCalled()
    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
    const [, documentId, extraData] = mocks.loadSiteResource.mock.calls[0]!
    expect(documentId).toMatchObject({uid: REGISTERED, path: ['about', 'team']})
    expect(extraData.homeMetadataPayload).toMatchObject({id: {uid: REGISTERED}, metadata: {name: 'Registered Site'}})
  })

  it('never checks mounts for the home page', async () => {
    await run('/')
    expect(mocks.getMetadata).not.toHaveBeenCalled()
    expect(mocks.loadSiteResource).toHaveBeenCalledTimes(1)
  })
})
