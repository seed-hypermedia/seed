/**
 * SSR Integration Test for Document Rendering
 *
 * This test verifies that server-side rendered pages show document content
 * instead of a loading spinner when React Query cache is properly hydrated.
 *
 * Run with: yarn web:test run ssr-document
 */

import {describe, expect, it, vi, beforeEach} from 'vitest'
import {renderToString} from 'react-dom/server'
import {createElement} from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TooltipProvider} from '@shm/ui/tooltip'
import {hmId} from '@shm/shared'
import type {HMDocument, HMResource} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'

// Test UID
const TEST_UID = 'z6MkkBQP6c9TQ5JsYJNyemvg1dU3s3AwprWRm8DZHL9VabQY'
const TEST_VERSION = 'test-version-123'

// Helper to wrap component in required providers
function withProviders(
  queryClient: QueryClient,
  component: React.ReactElement,
) {
  return createElement(
    QueryClientProvider,
    {client: queryClient},
    createElement(TooltipProvider, {children: component}),
  )
}

// Mock constants before imports
vi.mock('@shm/shared/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    DAEMON_FILE_URL: 'http://localhost:58001/ipfs',
    SITE_BASE_URL: 'http://localhost:3000',
    SEED_ASSET_HOST: 'http://localhost:58001',
    WEB_SIGNING_ENABLED: false,
    WEB_IDENTITY_ENABLED: false,
    WEB_IDENTITY_ORIGIN: '',
  }
})

// Mock the universal app context
vi.mock('@shm/shared', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    useUniversalAppContext: () => ({
      origin: 'http://localhost:3000',
      originHomeId: {
        uid: TEST_UID,
        id: `hm://${TEST_UID}`,
        path: [],
        version: null,
      },
      getOptimizedImageUrl: (cid: string) =>
        `http://localhost:58001/hm/api/image/${cid}`,
      ipfsFileUrl: 'http://localhost:58001/ipfs',
      openUrl: () => {},
      openRoute: () => {},
      onCopyReference: () => {},
      languagePack: undefined,
      universalClient: {},
    }),
  }
})

// Mock layout hook
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

// Mock search model to avoid universalClient requirement
vi.mock('@shm/shared/models/search', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    useSearch: () => ({
      data: [],
      isLoading: false,
    }),
  }
})

// Mock routing to provide a stub universalClient
vi.mock('@shm/shared/routing', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    useUniversalClient: () => ({
      documents: {searchDocuments: async () => ({documents: []})},
      request: async () => null,
      subscribeEntity: undefined,
    }),
  }
})

// Create test document (cast through unknown to avoid strict type checking in tests)
function createTestDocument(content: string): HMDocument {
  return {
    id: `hm://${TEST_UID}`,
    path: '',
    version: TEST_VERSION,
    account: TEST_UID,
    authors: [TEST_UID],
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    genesis: false,
    visibility: 'PUBLIC',
    metadata: {
      name: 'Test Document Title',
    },
    content: [
      {
        block: {
          id: 'block-1',
          type: 'Paragraph',
          text: content,
          annotations: [],
          attributes: {},
        },
        children: [],
      },
    ],
    detachedBlocks: {},
  } as unknown as HMDocument
}

// Create a resource response that wraps a document
function createDocumentResource(
  document: HMDocument,
  docId: ReturnType<typeof hmId>,
): HMResource {
  return {
    type: 'document',
    id: docId,
    document,
  } as HMResource
}

// Set up QueryClient with prefetched data (simulates SSR hydration)
function createHydratedQueryClient(
  docId: ReturnType<typeof hmId>,
  document: HMDocument,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {staleTime: Infinity},
    },
  })

  // Pre-populate the cache with document data at the correct query key
  // Query key format: [queryKeys.ENTITY, id.id, version]
  const queryKey = [queryKeys.ENTITY, docId.id, docId.version]
  queryClient.setQueryData(queryKey, createDocumentResource(document, docId))

  // Also prefetch the home document for the header
  const homeId = hmId(docId.uid, {latest: true})
  const homeQueryKey = [queryKeys.ENTITY, homeId.id, homeId.version]
  queryClient.setQueryData(
    homeQueryKey,
    createDocumentResource(document, homeId),
  )

  return queryClient
}

describe('SSR Document Rendering with React Query Hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render document content when QueryClient cache is hydrated', async () => {
    // Import after mocks are set up
    const {ResourcePage} = await import('@shm/ui/resource-page-common')

    const testContent = 'This is test document content for SSR hydration'
    const testDocument = createTestDocument(testContent)
    // Create ID with version (as the loader returns after fetching)
    const docId = hmId(TEST_UID, {version: TEST_VERSION})

    // Create QueryClient with hydrated data
    const queryClient = createHydratedQueryClient(docId, testDocument)

    // Render to string (simulates SSR)
    const html = renderToString(
      withProviders(queryClient, createElement(ResourcePage, {docId})),
    )

    // Verify document content is present in SSR output
    expect(html).toContain(testContent)

    // Verify no spinner is rendered (data was found in cache)
    expect(html).not.toContain('animate-spin')
  })

  it('should render spinner when QueryClient cache is NOT hydrated', async () => {
    // Import after mocks are set up
    const {ResourcePage} = await import('@shm/ui/resource-page-common')

    const docId = hmId(TEST_UID, {version: TEST_VERSION})

    // Create empty QueryClient (no hydrated data)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {staleTime: Infinity},
      },
    })

    // Render to string without hydrated data
    const html = renderToString(
      withProviders(queryClient, createElement(ResourcePage, {docId})),
    )

    // Without hydrated data, spinner should be shown during SSR
    expect(html).toContain('animate-spin')
  })

  it('should render content through WebResourcePage when cache is hydrated', async () => {
    // Import after mocks are set up
    const {WebResourcePage} = await import('@/web-resource-page')

    const testContent = 'WebResourcePage SSR hydration test content'
    const testDocument = createTestDocument(testContent)
    const docId = hmId(TEST_UID, {version: TEST_VERSION})

    // Create QueryClient with hydrated data
    const queryClient = createHydratedQueryClient(docId, testDocument)

    // Render WebResourcePage to string
    const html = renderToString(
      withProviders(queryClient, createElement(WebResourcePage, {docId})),
    )

    // Verify document content passes through
    expect(html).toContain(testContent)
    expect(html).not.toContain('animate-spin')
  })
})
