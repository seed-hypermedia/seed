/**
 * SSR through the real loader: what the loader dehydrates is what the page hydrates.
 *
 * ssr-document.integration.test.ts renders the resource page from a hand-seeded query cache,
 * which proves the page can render from a cache but says nothing about whether the loader
 * fills that cache correctly. #1120 lived exactly in that gap: the loader had the document,
 * dehydrated it under an id the daemon could not serve, and the page rendered "Document Not
 * Found". This file closes the seam: run loadResource against the fake daemon, hydrate a
 * QueryClient from its dehydratedState, and server-render ResourcePage for the id it handed
 * back — for a plain document and for a republish.
 */
import {hydrate, QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TooltipProvider} from '@shm/ui/tooltip'
import {hmId} from '@shm/shared'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {FakeDaemon, makeDocument, OTHER_UID, SITE_UID} from './loaders.test-support'

const state = vi.hoisted(() => ({
  daemon: null as unknown as {
    fetch: (id: any) => unknown
    resolve: (id: any) => Promise<unknown>
    request: (name: string, input: any) => Promise<unknown>
    getDocument: (req: any) => Promise<unknown>
  },
  navRoute: {key: 'document', id: null as unknown as UnpackedHypermediaId},
  originHomeId: null as unknown as UnpackedHypermediaId,
}))

// ---- loader side: every daemon surface goes to the fake daemon ----
vi.mock('./client.server', () => ({
  grpcClient: {documents: {getDocument: (req: unknown) => state.daemon.getDocument(req)}},
  transport: {},
  domainResolver: {},
}))
vi.mock('./server-universal-client', () => ({
  serverUniversalClient: {
    request: (name: string, input: unknown) => state.daemon.request(name, input),
    publish: async () => ({cids: []}),
  },
}))
vi.mock('@shm/shared/resource-loader', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createResourceFetcher: () => async (id: unknown) => state.daemon.fetch(id),
    createResourceResolver: () => async (id: unknown) => state.daemon.resolve(id),
  }
})
vi.mock('@shm/shared/document-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {...actual, prepareHMDocument: (doc: unknown) => doc}
})
vi.mock('./utils/discovery', () => ({discoverDocument: async () => null}))
vi.mock('@shm/editor/ssr-render', () => ({renderDocumentToHTML: () => ''}))
vi.mock('./site-config.server', () => ({
  getConfig: async () => ({registeredAccountUid: SITE_UID}),
  getServiceConfig: async () => null,
  getHostnames: () => [],
}))

// ---- render side: the same stubs ssr-document.integration.test.ts uses ----
vi.mock('@shm/shared/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    DAEMON_FILE_URL: 'http://localhost:58001/ipfs',
    SITE_BASE_URL: 'http://localhost:3000',
    SEED_ASSET_HOST: 'http://localhost:58001',
    WEB_SIGNING_ENABLED: false,
    WEB_IDENTITY_ENABLED: false,
    WEB_IDENTITY_ORIGIN: '',
    WEB_IS_GATEWAY: false,
  }
})
vi.mock('@shm/shared', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useUniversalAppContext: () => ({
      origin: 'http://localhost:3000',
      originHomeId: state.originHomeId,
      getOptimizedImageUrl: (cid: string) => `http://localhost:58001/hm/api/image/${cid}`,
      ipfsFileUrl: 'http://localhost:58001/ipfs',
      openUrl: () => {},
      openRoute: () => {},
      onCopyReference: () => {},
      languagePack: undefined,
      universalClient: {request: async () => null, publish: async () => ({cids: []})},
    }),
  }
})
vi.mock('@shm/ui/layout', () => ({
  useDocumentLayout: () => ({
    showSidebars: false,
    sidebarProps: {},
    mainContentProps: {},
    elementRef: {current: null},
    wrapperProps: {className: ''},
    contentMaxWidth: '800px',
  }),
}))
vi.mock('@shm/shared/models/search', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {...actual, useSearch: () => ({data: [], isLoading: false})}
})
vi.mock('@shm/editor/comment-editor', () => ({CommentEditor: () => null, HypermediaCommentEditor: () => null}))
vi.mock('@/auth', () => ({
  useLocalKeyPair: () => null,
  useCreateAccount: () => ({content: null, createAccount: () => {}}),
  useVaultSuccessDialog: () => null,
  AccountFooterActions: () => null,
  EditProfileDialog: () => null,
  LogoutButton: () => null,
  LogoutDialog: () => null,
}))
vi.mock('@shm/shared/utils/navigation', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const nav = {
    state: {subscribe: () => () => {}, get: () => ({routes: [state.navRoute], routeIndex: 0})},
    dispatch: () => {},
  }
  return {
    ...actual,
    useNavRoute: () => state.navRoute,
    useNavigate: () => () => {},
    useNavigation: () => nav,
    useNavigationState: () => ({routes: [state.navRoute], routeIndex: 0}),
    useNavigationDispatch: () => () => {},
  }
})
vi.mock('@shm/shared/routing', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useUniversalClient: () => ({
      documents: {searchDocuments: async () => ({documents: []})},
      request: async () => null,
      publish: async () => ({cids: []}),
      subscribeEntity: undefined,
    }),
  }
})

let daemon: FakeDaemon

beforeEach(() => {
  daemon = new FakeDaemon()
  state.daemon = daemon
  state.originHomeId = hmId(SITE_UID)
  // Every site has a home document; the page shell reads it.
  daemon.putDocument(makeDocument({uid: SITE_UID, path: [], version: 'home1', name: 'Site Home'}))
})

async function renderThroughLoader(routeId: UnpackedHypermediaId) {
  const {loadResource} = await import('./loaders')
  const {parseRequest} = await import('./request')
  const {ResourcePage} = await import('@shm/ui/resource-page-common')

  const payload = await loadResource(
    routeId,
    parseRequest(new Request(`https://site.example/${routeId.path?.join('/')}`)),
  )

  const queryClient = new QueryClient({defaultOptions: {queries: {staleTime: Infinity}}})
  hydrate(queryClient, payload.dehydratedState)
  state.navRoute = {key: 'document', id: payload.id}

  const StubContent = () => createElement('div', {'data-testid': 'content'}, payload.document.metadata.name)
  const html = renderToString(
    createElement(
      QueryClientProvider,
      {client: queryClient},
      createElement(
        TooltipProvider,
        null,
        createElement(ResourcePage, {docId: payload.id, DocumentContentComponent: StubContent} as any),
      ),
    ),
  )
  return {payload, html}
}

describe('SSR through the loader', () => {
  it('renders a plain document from the loader dehydrated state', async () => {
    daemon.putDocument(makeDocument({uid: SITE_UID, path: ['guide'], version: 'v1', name: 'The Guide'}))

    const {html} = await renderThroughLoader(hmId(SITE_UID, {path: ['guide'], latest: true}))

    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('Document Not Found')
    expect(html).toContain('The Guide')
  })

  it('renders a republished document at the republish address from the loader dehydrated state', async () => {
    daemon.putDocument(makeDocument({uid: OTHER_UID, path: ['2026', 'paper'], version: 'vT', name: 'The Paper'}))
    const routeId = hmId(SITE_UID, {path: ['paper'], latest: true})
    daemon.putRedirect(routeId, hmId(OTHER_UID, {path: ['2026', 'paper']}), {republish: true})

    const {payload, html} = await renderThroughLoader(routeId)

    expect(payload.id).toMatchObject({uid: SITE_UID, path: ['paper']})
    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('Document Not Found')
    expect(html).toContain('The Paper')
  })
})
