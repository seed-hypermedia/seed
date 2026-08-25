import {getQueryBlockInput} from '@shm/editor/query-block-input'
import {renderDocumentToHTML} from '@shm/editor/ssr-render'
import {hmBlockToEditorBlock} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {Code, ConnectError} from '@connectrpc/connect'
import {redirect} from '@remix-run/react'
import {accountMetadataFromAccount} from '@shm/shared/account-metadata'
import {
  HMDocument,
  HMDocumentMetadataSchema,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  commentIdToHmId,
  extractQueryBlocks,
  extractRefs,
  getBreadcrumbDocumentIds,
  getCommentTargetId,
  hmId,
  hmIdPathToEntityQueryPath,
  hypermediaUrlToHref,
  packHmId,
  RedirectErrorDetails,
} from '@shm/shared'
import {DAEMON_FILE_URL, SITE_BASE_URL, WEB_SIGNING_ENABLED} from '@shm/shared/constants'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {HMComment, HMCommentSchema, HMResource} from '@seed-hypermedia/client/hm-types'
import {
  documentMetadataParseAdjustments,
  getErrorMessage,
  HMError,
  HMNotFoundError,
  HMRedirectError,
} from '@shm/shared/models/entity'
import {
  queryAccount,
  queryCommentVersions,
  queryDirectory,
  queryDocumentCollaborators,
  queryQueryBlock,
  queryResource,
} from '@shm/shared/models/queries'
import {createResourceFetcher, createResourceResolver} from '@shm/shared/resource-loader'
import {DehydratedState} from '@tanstack/react-query'
import {grpcClient} from './client.server'
import {instrument, InstrumentationContext} from './instrumentation.server'
import {getOptimizedImageUrl} from './providers'
import {createPrefetchContext, dehydratePrefetchContext, PrefetchContext} from './queries.server'
import {ParsedRequest} from './request'
import {createResourceRedirectUrl, RedirectRouteContext} from './resource-redirect'
import {serverUniversalClient} from './server-universal-client'
import {getConfig} from './space-config.server'
import {createResourceMetadata, metadataToHeaders} from './hypermedia-metadata'
import {discoverDocument} from './utils/discovery'
import {wrapJSON, WrappedResponse} from './wrapping.server'
import {WEB_IS_GATEWAY} from '@shm/shared/constants'

/**
 * Thrown when a resource is not available locally. On gateways we never hold
 * the HTTP request open waiting for discovery, and we never start discovery
 * server-side — the route returns a shim page whose JS polls
 * /api/DiscoveryStatus, and that first poll is what starts the daemon's
 * discovery task.
 */
export class HMDiscoveryPendingError extends Error {
  constructor() {
    super('Resource not found locally; client may start discovery')
  }
}

export async function getMetadata(id: UnpackedHypermediaId): Promise<HMMetadataPayload> {
  try {
    const rawDoc = await grpcClient.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: id.latest ? undefined : id.version || undefined,
    })
    const metadataJSON = rawDoc.metadata?.toJson({
      emitDefaultValues: true,
      enumAsInteger: false,
    })
    documentMetadataParseAdjustments(metadataJSON)
    return {
      id,
      metadata: HMDocumentMetadataSchema.parse(metadataJSON),
      hasSite: id.path?.length ?? 0 === 0 ? !!rawDoc.content.length : undefined,
    }
  } catch (e) {
    return {id, metadata: {}}
  }
}

export async function getAccount(
  accountUid: string,
  {discover}: {discover?: boolean} = {},
): Promise<HMMetadataPayload> {
  try {
    if (discover && false) {
      // @ts-expect-error
      await discoverDocument(accountUid, [], undefined)
    }
    const grpcAccount = await grpcClient.documents.getAccount({
      id: accountUid,
    })
    if (grpcAccount.aliasAccount) {
      return await getAccount(grpcAccount.aliasAccount)
    }
    const metadata = accountMetadataFromAccount(grpcAccount)
    return {
      id: hmId(accountUid),
      metadata,
    } as HMMetadataPayload
  } catch (e) {
    console.error('Error getting account ' + accountUid, e)
    return {id: hmId(accountUid), metadata: {}}
  }
}

export async function getComment(id: string): Promise<HMComment | null> {
  try {
    const rawDoc = await grpcClient.comments.getComment({
      id,
    })
    return HMCommentSchema.parse(rawDoc.toJson({emitDefaultValues: true, enumAsInteger: false}))
  } catch (error: any) {
    // Handle ConnectError for NotFound comments gracefully
    if (error?.code === 'not_found' || error?.message?.includes('not found')) {
      console.warn(`Comment ${id} not found, treating as acceptable warning`)
      return null
    }
    // Re-throw other errors
    throw error
  }
}

export type WebResourcePayload = {
  // ID refers to the primary resource that is loaded.
  id: UnpackedHypermediaId

  // if the resource is a comment, it will be present
  comment?: HMComment | null

  // if the resource is a comment, this is the target document. Otherwise, it is the doc identified by the resource ID
  document: HMDocument

  spaceHost: string | undefined
  isLatest: boolean

  // Icon from the document's home (for favicon in SSR)
  spaceHomeIcon?: string | null

  // Dehydrated React Query state for SSR hydration
  dehydratedState?: DehydratedState

  // Pre-rendered document content HTML for SSR (avoids blank flash before editor loads)
  ssrContentHTML?: string | null
}

export async function getDocument(
  resourceId: UnpackedHypermediaId,
  {discover}: {discover?: boolean} = {},
): Promise<HMDocument> {
  const {version, uid, latest} = resourceId
  if (discover && false) {
    // @ts-expect-error
    return await discoverDocument(uid, resourceId.path || [], version || undefined, latest)
  }
  const path = hmIdPathToEntityQueryPath(resourceId.path)
  const apiResponse = await grpcClient.documents
    .getDocument({
      account: uid,
      path,
      version: latest ? undefined : version || '',
    })
    .catch((e) => {
      const error = getErrorMessage(e)
      if (error instanceof HMError) {
        // console.error('~~ HMRedirectError to', error.target)
        return error
      }
      throw e
    })
  if (apiResponse instanceof HMError) {
    throw apiResponse
  }
  return prepareHMDocument(apiResponse)
}

export async function resolveHMDocument(
  resourceId: UnpackedHypermediaId,
  {discover}: {discover?: boolean} = {},
): Promise<HMDocument> {
  try {
    const document = await getDocument(resourceId, {discover})
    return document
  } catch (e) {
    if (e instanceof HMRedirectError) {
      return await resolveHMDocument(e.target, {discover})
    }
    throw e
  }
}

export function getOriginRequestData(parsedRequest: ParsedRequest) {
  const enableWebSigning = WEB_SIGNING_ENABLED && parsedRequest.origin === SITE_BASE_URL

  return {
    enableWebSigning,
    spaceHost: parsedRequest.origin,
    origin: parsedRequest.origin,
  }
}

async function getLatestDocument(resourceId: UnpackedHypermediaId) {
  const latestDocument =
    !!resourceId.version && !resourceId.latest
      ? await getDocument({...resourceId, latest: true, version: null}, {discover: true})
      : null
  return latestDocument
}

export async function loadDocument(
  resourceId: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
): Promise<WebResourcePayload> {
  const document = await getDocument(resourceId, {discover: true})

  const latestDocument = await getLatestDocument(resourceId)
  return await loadResourcePayload(resourceId, parsedRequest, {
    document,
    latestDocument,
  })
}

// =============================================================================
// PREFETCH ARCHITECTURE
// =============================================================================

/**
 * Prefetch all data needed for React Query hydration.
 * This replaces the dual-phase (eager fetch + prefetch) architecture with a single
 * prefetch-only approach. React Query deduplicates identical queries automatically.
 */
async function prefetchResourceData(
  docId: UnpackedHypermediaId,
  document: HMDocument,
  prefetchCtx: PrefetchContext,
  ctx?: InstrumentationContext,
): Promise<void> {
  const client = serverUniversalClient
  const homeId = hmId(docId.uid, {latest: true})
  const noopCtx = createNoopInstrumentationContext()
  const breadcrumbIds = getBreadcrumbDocumentIds(docId)
  const baseResourceKeys = new Set([`${docId.id}:${docId.version || ''}`, `${homeId.id}:`])
  const breadcrumbResourceIds = breadcrumbIds.filter((id) => {
    const key = `${id.id}:${id.version || ''}`
    return !baseResourceKeys.has(key)
  })

  // Wave 1: Core navigation data (parallel, no dependencies)
  await instrument(ctx || noopCtx, 'prefetchWave1', () =>
    Promise.allSettled([
      instrument(ctx || noopCtx, `prefetchResource(${packHmId(docId)})`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryResource(client, docId)),
      ),
      instrument(ctx || noopCtx, `prefetchResource(${packHmId(homeId)})`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId)),
      ),
      instrument(ctx || noopCtx, `prefetchDirectory(${packHmId(homeId)}, Children)`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryDirectory(client, homeId, 'Children')),
      ),
      instrument(ctx || noopCtx, `prefetchDirectory(${packHmId(docId)}, Children)`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryDirectory(client, docId, 'Children')),
      ),
      // NOTE: the document's own interaction summary is deliberately NOT
      // prefetched here. See the comment on Wave 3 below: computing it
      // enumerates every citation of the document, which is unbounded work per
      // render. `useInteractionSummary` fetches it on the client instead.
      // Collaborators drive the "People" tab count (and the home-doc members
      // facepile); without prefetch the count pops in and shifts the tab row.
      instrument(ctx || noopCtx, `prefetchCollaborators(${packHmId(docId)})`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryDocumentCollaborators(client, docId)),
      ),
      instrument(ctx || noopCtx, `prefetchCollaborators(${packHmId(homeId)})`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryDocumentCollaborators(client, homeId)),
      ),
      ...breadcrumbResourceIds.map((id) =>
        instrument(ctx || noopCtx, `prefetchBreadcrumbResource(${packHmId(id)})`, () =>
          prefetchCtx.queryClient.prefetchQuery(queryResource(client, id)),
        ),
      ),
    ]),
  )

  // Wave 2: Content dependencies (parallel, depends on document content)
  const queryBlocks = extractQueryBlocks(document.content)
  const refs = extractRefs(document.content)

  await instrument(ctx || noopCtx, 'prefetchWave2', () =>
    Promise.allSettled([
      // Query block payloads. The input must be derived through the SAME
      // editor-block conversion the query block component uses, or the cache
      // key won't match and the prefetched data is never found (SSR renders
      // an empty query block and the client refetches).
      ...queryBlocks.map((block) => {
        const input = getQueryBlockInput(hmBlockToEditorBlock(block).props as any)
        if (!input) return Promise.resolve()
        return instrument(ctx || noopCtx, 'prefetchQueryBlock', () =>
          prefetchCtx.queryClient.prefetchQuery(queryQueryBlock(client, input)),
        )
      }),
      // Embedded document content
      ...refs.map((ref) =>
        instrument(ctx || noopCtx, `prefetchEmbedResource(${packHmId(ref.refId)})`, () =>
          prefetchCtx.queryClient.prefetchQuery(queryResource(client, ref.refId)),
        ),
      ),
      // Author accounts
      ...document.authors.map((uid) =>
        instrument(ctx || noopCtx, `prefetchAccount(${uid})`, () =>
          prefetchCtx.queryClient.prefetchQuery(queryAccount(client, uid)),
        ),
      ),
    ]),
  )

  // Interaction summaries are deliberately NOT server-rendered.
  //
  // They used to be prefetched here for up to 30 embed cards per render. Each
  // one costs an unbounded amount of work: InteractionSummary derives its
  // counts by enumerating EVERY citation of its target through listAllPages
  // (500 per page), and each ListCitations materialises the target's whole
  // citation fan-out before applying its LIMIT — 0.3-2.5s of daemon CPU per
  // call, measured against the production database. Thirty of those per page
  // view took hyper.media and every hosted space down on 2026-08-11: ~1.9
  // req/s was enough to pin all 8 cores, with ListCitations at 87% of CPU.
  //
  // Crawlers never run JS, so serving them these counts was pure waste. The
  // counts now load client-side via useInteractionSummary, for the cards a
  // real reader actually has on screen. Query-block cards and list items are
  // unaffected either way: their comment/children counts ride on each listing
  // item's activitySummary and reach them through the payload's
  // interactionSummaries, with no per-item requests.
  //
  // Before restoring any of this, give the daemon a way to report citation
  // counts without enumerating citations, the way children_count already works
  // for directories (see getDocumentInfo in api-interaction-summary.ts).
}

/** JSON stringify that survives the bigint fields in daemon payloads. */
function stringifyWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

/** Mirrors getContentWidth in @shm/ui/layout (S/M/L → px). */
function getContentWidthValue(contentWidth: unknown): number {
  if (contentWidth === 'S') return 600
  if (contentWidth === 'L') return 900
  return 700
}

/** Cheap stable fingerprint (djb2) for SSR cache keys. */
function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/**
 * Extract home document from the prefetch cache.
 */
function getHomeDocumentFromCache(prefetchCtx: PrefetchContext, homeId: UnpackedHypermediaId): HMDocument | null {
  const client = serverUniversalClient
  const resource = prefetchCtx.queryClient.getQueryData(queryResource(client, homeId).queryKey) as HMResource | null
  return resource?.type === 'document' ? resource.document : null
}

/**
 * Create a noop instrumentation context for when none is provided.
 */
function createNoopInstrumentationContext(): InstrumentationContext {
  return {
    enabled: false,
    requestPath: '',
    requestMethod: '',
    root: {name: '', start: 0, children: []},
    current: {name: '', start: 0, children: []},
  } as InstrumentationContext
}

/**
 * Load resource payload using prefetch-only architecture.
 * React Query handles deduplication automatically.
 */
async function loadResourcePayload(
  docId: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
  payload: {
    document: HMDocument
    latestDocument?: HMDocument | null
    comment?: HMComment
    commentId?: UnpackedHypermediaId
  },
  ctx?: InstrumentationContext,
  options?: {
    originHomeId?: UnpackedHypermediaId
  },
): Promise<WebResourcePayload> {
  const {document, latestDocument, comment, commentId} = payload
  const prefetchCtx = createPrefetchContext()
  const homeId = hmId(docId.uid, {latest: true})

  // Create the final ID that will be returned to the client.
  // Clear `latest` when pinning to a specific version — otherwise the client's
  // REST fetch includes both `?v=...&l`, the handler drops the version, and the
  // daemon may return a stale "latest" pointer (overwriting correct SSR data).
  const finalId: UnpackedHypermediaId = {...docId, version: document.version, latest: false}

  // Single prefetch phase - use finalId so query keys match on client
  await prefetchResourceData(finalId, document, prefetchCtx, ctx)

  // For comments, also prefetch the comment resource so useResource(commentId) has data
  if (commentId) {
    const client = serverUniversalClient
    await prefetchCtx.queryClient.prefetchQuery(queryResource(client, commentId))
  }

  // Extract data from cache for SSR response
  const homeDocument = getHomeDocumentFromCache(prefetchCtx, homeId)
  const client = serverUniversalClient

  // Server-render document content as real editor markup so the swap to the
  // live editor is invisible. The render reads prefetched data beyond the
  // document itself (query results, embedded docs, interaction summaries,
  // account metadata, …), all of which change independently of the document
  // version — so the ENTIRE prefetched dataset is fingerprinted into the
  // cache key. Any data change misses the cache and re-renders (~4-15ms on
  // the heaviest real pages); a hit can never serve stale markup.
  const dehydratedState = dehydratePrefetchContext(prefetchCtx)
  const dataFingerprint = hashString(
    stringifyWithBigInt(
      dehydratedState.queries
        .map((q) => [q.queryHash, q.state.data] as const)
        // Prefetch completion order varies run-to-run; sort for a stable key.
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    ),
  )

  const {origin} = getOriginRequestData(parsedRequest)
  const originHomeId = options?.originHomeId
  const cacheKey = document.version
    ? `${origin}|${originHomeId?.uid || 'no-home'}|${docId.uid}/${docId.path?.join('/') || ''}@${
        document.version
      }|d:${dataFingerprint}`
    : undefined
  const ssrContentHTML = document.content
    ? renderDocumentToHTML(document.content, {
        cacheKey,
        rootChildrenType: document.metadata?.childrenType,
        renderHref: (url) =>
          hypermediaUrlToHref(url, {
            origin,
            originHomeId,
          }) || url,
        queryClient: prefetchCtx.queryClient,
        // The mounted editor's content width: contentWidth setting minus the
        // px-4 content padding. Media with absolute px widths size against it.
        editorWidth: getContentWidthValue(document.metadata?.contentWidth) - 32,
        // The same context values WebSpaceProvider passes on the client, so
        // block components produce identical URLs server-side.
        appContext: {
          origin,
          originHomeId,
          universalClient: client,
          ipfsFileUrl: DAEMON_FILE_URL,
          getOptimizedImageUrl,
          openUrl: () => {},
        },
      })
    : null
  if (ssrContentHTML) {
    console.log(`[ssr-render] Generated ${ssrContentHTML.length} chars of SSR HTML for ${cacheKey || 'uncached'}`)
  } else if (document.content?.length) {
    console.warn(
      `[ssr-render] Failed to generate SSR HTML for ${cacheKey || 'unknown'} (${document.content.length} blocks)`,
    )
  }

  return {
    document,
    ...(comment != null ? {comment} : {}),
    isLatest: !latestDocument || latestDocument.version === document.version,
    // For comments, return the comment's own ID so the client route uses it
    id: commentId || finalId,
    spaceHomeIcon: homeDocument?.metadata?.icon || null,
    dehydratedState,
    ssrContentHTML,
    ...getOriginRequestData(parsedRequest),
  }
}

// Low-level fetcher - returns all types including redirect and not-found
export const fetchResource = createResourceFetcher(grpcClient)

// Mid-level resolver - follows redirects, throws on not-found
export const resolveResource = createResourceResolver(grpcClient)

// High-level loader - resolves, adds author metadata, breadcrumbs, support docs, etc.
export async function loadResource(
  id: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
  ctx?: InstrumentationContext,
  options?: {
    originHomeId?: UnpackedHypermediaId
  },
): Promise<WebResourcePayload> {
  const noopCtx = {
    enabled: false,
    requestPath: '',
    requestMethod: '',
    root: {name: '', start: 0, children: []},
    current: {name: '', start: 0, children: []},
  } as InstrumentationContext

  const resource = await instrument(ctx || noopCtx, `fetchResource(${packHmId(id)})`, () => fetchResource(id))
  if (resource.type === 'redirect' && resource.republish) {
    // A republish redirect renders the target's latest content at THIS route — matching the
    // client-side queryResource behavior — instead of bouncing the browser to the target URL.
    const followed = await instrument(ctx || noopCtx, `followRepublish(${packHmId(resource.redirectTarget)})`, () =>
      resolveResource(resource.redirectTarget),
    )
    if (followed.type === 'document') {
      const latestDocument = await instrument(ctx || noopCtx, `getLatestDocument(${packHmId(followed.id)})`, () =>
        getLatestDocument(followed.id),
      )
      return await loadResourcePayload(
        id,
        parsedRequest,
        {
          document: followed.document,
          latestDocument,
        },
        ctx,
        options,
      )
    }
    // The chain does not end at a live document — fall through to the plain-redirect handling.
  }
  if (resource.type === 'redirect') {
    // The destination URL is built in loadSpaceResource, which has the route
    // context (view term, open comment, panel) that must survive the redirect.
    throw new HMRedirectError(
      new RedirectErrorDetails({
        targetAccount: resource.redirectTarget.uid,
        targetPath: hmIdPathToEntityQueryPath(resource.redirectTarget.path),
        republish: resource.republish,
      }),
    )
  }
  if (resource.type === 'not-found') {
    throw new HMNotFoundError()
  }
  if (resource.type === 'error') {
    throw new Error(resource.message)
  }
  if (resource.type === 'comment') {
    const comment = resource.comment
    const commentId = resource.id
    const targetDocId = getCommentTargetId(comment)
    if (!targetDocId) throw new Error('targetDocId not found')
    const document = await instrument(ctx || noopCtx, `getDocument(comment:${packHmId(targetDocId)})`, () =>
      getDocument(targetDocId, {discover: true}),
    )
    return await loadResourcePayload(
      targetDocId,
      parsedRequest,
      {
        document,
        comment,
        commentId,
      },
      ctx,
      options,
    )
  }
  if (resource.type === 'tombstone') {
    throw new Error('Resource has been deleted')
  }
  // resource.type === 'document'
  const document = resource.document
  const latestDocument = await instrument(ctx || noopCtx, `getLatestDocument(${packHmId(id)})`, () =>
    getLatestDocument(id),
  )
  return await loadResourcePayload(
    id,
    parsedRequest,
    {
      document,
      latestDocument,
    },
    ctx,
    options,
  )
}

// High-level loader with discovery fallback - tries to discover if not found
export async function loadResourceWithDiscovery(
  id: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
  ctx?: InstrumentationContext,
  options?: {
    originHomeId?: UnpackedHypermediaId
  },
): Promise<WebResourcePayload> {
  const noopCtx = {
    enabled: false,
    requestPath: '',
    requestMethod: '',
    root: {name: '', start: 0, children: []},
    current: {name: '', start: 0, children: []},
  } as InstrumentationContext

  try {
    return await loadResource(id, parsedRequest, ctx, options)
  } catch (e) {
    if (e instanceof HMNotFoundError) {
      if (WEB_IS_GATEWAY) {
        // Never start discovery from SSR. Only clients that execute JS may
        // trigger it: the shim page's first /api/DiscoveryStatus poll is
        // what starts the daemon's discovery task. Bots and vulnerability
        // scanners probe large numbers of nonexistent paths without running
        // JS, and a server-side poke here would queue an expensive recursive
        // P2P discovery task for every probe.
        throw new HMDiscoveryPendingError()
      } else {
        const discovered = await instrument(ctx || noopCtx, `discoverDocument(${packHmId(id)})`, () =>
          discoverDocument(id.uid, id.path || [], id.version || undefined, id.latest),
        )
        if (discovered) {
          return await loadResource(id, parsedRequest, ctx, options)
        }
      }
    }
    throw e
  }
}

export type SpaceDocumentPayload = WebResourcePayload & {
  homeMetadata: HMMetadata
  originHomeId: UnpackedHypermediaId
  origin: string
  comment?: HMComment
  daemonError?: GRPCError
  // True when the resource is not available locally and an async discovery
  // task is running. The route renders a shim page that polls for completion.
  discoveryPending?: boolean
  metadataId: UnpackedHypermediaId
}

// We have to define our own error type here instead of using the ConnectError type,
// because for some reason the code gets stripped away when data is passed from the loader to the component,
// probably due to superjson serialization.
export type GRPCError = {
  message: string
  code: Code
}

/** Load the shell data for a local web draft placeholder URL without backend document fetch. */
export async function loadWebDraftPlaceholderResource<T extends Record<string, unknown> = Record<string, never>>(
  parsedRequest: ParsedRequest,
  id: UnpackedHypermediaId,
  extraData?: T & {instrumentationCtx?: InstrumentationContext},
): Promise<WrappedResponse<SpaceDocumentPayload & Omit<T, 'instrumentationCtx'>>> {
  const {hostname, origin} = parsedRequest
  const ctx = extraData?.instrumentationCtx
  const noopCtx = {
    enabled: false,
    requestPath: '',
    requestMethod: '',
    root: {name: '', start: 0, children: []},
    current: {name: '', start: 0, children: []},
  } as InstrumentationContext

  const config = await getConfig(hostname)
  if (!config) {
    throw new Error('No config found for hostname ' + hostname)
  }
  let homeMetadata = null
  let originHomeId: undefined | UnpackedHypermediaId = undefined
  if (config.registeredAccountUid) {
    const homeId = hmId(config.registeredAccountUid)
    try {
      const result = await instrument(ctx || noopCtx, `getHomeMetadata(${packHmId(homeId)})`, () => getMetadata(homeId))
      homeMetadata = result.metadata
      originHomeId = result.id
    } catch (e) {}
  }

  const document = {
    account: id.uid,
    path: `/${(id.path ?? []).join('/')}`,
    content: [],
    metadata: {},
    visibility: undefined,
    version: '',
    authors: [],
    createTime: undefined,
    updateTime: undefined,
    genesis: '',
  } as unknown as HMDocument

  const loadedSpaceDocument = {
    ...(extraData || {}),
    id,
    document,
    spaceHost: origin,
    isLatest: false,
    ssrContentHTML: null,
    homeMetadata,
    origin,
    originHomeId,
    metadataId: id,
  }
  const {instrumentationCtx: _, ...cleanDocument} = loadedSpaceDocument as any
  return wrapJSON(cleanDocument)
}

export async function loadSpaceResource<T extends Record<string, unknown> = Record<string, never>>(
  parsedRequest: ParsedRequest,
  id: UnpackedHypermediaId,
  extraData?: T & {
    instrumentationCtx?: InstrumentationContext
    viewTerm?: string | null
    accountUid?: string | null
    openComment?: string | null
    commentVersion?: string | null
  },
): Promise<WrappedResponse<SpaceDocumentPayload & Omit<T, 'instrumentationCtx'>>> {
  const {hostname, origin} = parsedRequest
  const ctx = extraData?.instrumentationCtx
  // Profile pages render/load the account root document, but the public
  // metadata identifies the profile view term addressed by the URL.
  const metadataId =
    extraData?.viewTerm === 'profile'
      ? {
          ...hmId(extraData.accountUid || id.uid, {version: id.version, latest: id.latest}),
          id: `hm://${extraData.accountUid || id.uid}/:profile`,
        }
      : id
  const noopCtx = {
    enabled: false,
    requestPath: '',
    requestMethod: '',
    root: {name: '', start: 0, children: []},
    current: {name: '', start: 0, children: []},
  } as InstrumentationContext

  const config = await getConfig(hostname)
  if (!config) {
    throw new Error('No config found for hostname ' + hostname)
  }
  let homeMetadata = null
  let originHomeId: undefined | UnpackedHypermediaId = undefined
  if (config.registeredAccountUid) {
    const homeId = hmId(config.registeredAccountUid)
    try {
      const result = await instrument(ctx || noopCtx, `getHomeMetadata(${packHmId(homeId)})`, () => getMetadata(homeId))
      homeMetadata = result.metadata
      originHomeId = result.id
    } catch (e) {}
  }
  try {
    const resourceContent = await instrument(ctx || noopCtx, `loadResourceWithDiscovery(${packHmId(id)})`, () =>
      loadResourceWithDiscovery(id, parsedRequest, ctx, {originHomeId}),
    )

    // Resolve comment when URL addresses one (e.g. /:comment/UID/TSID)
    let comment = resourceContent.comment
    let commentAuthorTitle: string | undefined
    const openCommentId = extraData?.openComment || undefined
    const openCommentVersion = extraData?.commentVersion || undefined
    if (!comment && openCommentId) {
      try {
        // ?v on comment permalinks is the comment version CID. The comments
        // API accepts either the stable comment id or a version CID.
        comment = (await getComment(openCommentVersion || openCommentId)) ?? undefined
        if (comment?.author) {
          try {
            const authorResource = await resolveResource(hmId(comment.author))
            if (authorResource.type === 'document') {
              commentAuthorTitle = authorResource.document.metadata.name || undefined
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // When viewing a profile, prefetch the account data so the client
    // doesn't enter the "discovering" state (web has no discovery service).
    const accountUid = extraData?.accountUid || undefined
    let mergedDehydratedState = resourceContent.dehydratedState
    // When a comment permalink pins an old comment version, prefetch the edit
    // history so the client renders that version without a flash of the
    // current content.
    if (openCommentId && openCommentVersion) {
      try {
        const versionsPrefetchCtx = createPrefetchContext()
        await versionsPrefetchCtx.queryClient.prefetchQuery(queryCommentVersions(serverUniversalClient, openCommentId))
        const versionsDehydrated = dehydratePrefetchContext(versionsPrefetchCtx)
        mergedDehydratedState = mergedDehydratedState
          ? {
              mutations: [...mergedDehydratedState.mutations, ...versionsDehydrated.mutations],
              queries: [...mergedDehydratedState.queries, ...versionsDehydrated.queries],
            }
          : versionsDehydrated
      } catch (e) {}
    }
    if (accountUid) {
      const profilePrefetchCtx = createPrefetchContext()
      const client = serverUniversalClient
      const profileId = hmId(accountUid)
      await Promise.all([
        profilePrefetchCtx.queryClient.prefetchQuery(queryAccount(client, accountUid)),
        profilePrefetchCtx.queryClient.prefetchQuery(queryResource(client, profileId)),
      ])
      const profileDehydrated = dehydratePrefetchContext(profilePrefetchCtx)
      if (mergedDehydratedState) {
        mergedDehydratedState = {
          mutations: [...mergedDehydratedState.mutations, ...profileDehydrated.mutations],
          queries: [...mergedDehydratedState.queries, ...profileDehydrated.queries],
        }
      } else {
        mergedDehydratedState = profileDehydrated
      }
    }

    const loadedSpaceDocument = {
      ...(extraData || {}),
      ...resourceContent,
      ...(comment ? {comment} : {}),
      dehydratedState: mergedDehydratedState,
      homeMetadata,
      origin,
      originHomeId,
      metadataId,
    }
    // Remove instrumentationCtx from the response
    const {instrumentationCtx: _, ...cleanDocument} = loadedSpaceDocument as any
    const metadata = createResourceMetadata({
      id: comment ? commentIdToHmId(comment.id) : metadataId,
      document: resourceContent.document,
      comment,
      commentAuthorTitle,
    })
    return wrapJSON(cleanDocument, {
      headers: metadataToHeaders(metadata),
    })
  } catch (e) {
    if (e instanceof Response) {
      throw e
    }
    if (e instanceof HMDiscoveryPendingError) {
      const {instrumentationCtx: _, ...cleanExtraData} = (extraData || {}) as any
      return wrapJSON(
        {
          id,
          homeMetadata,
          origin,
          originHomeId,
          metadataId,
          discoveryPending: true,
          ...cleanExtraData,
        },
        // The shim is a transient state — make sure no cache holds onto it.
        // 404 status: the resource is not available here (yet). Non-JS
        // clients (crawlers, scanners) see a plain not-found; browsers still
        // render the shim and poll. On success the reload gets a 200.
        {status: 404, headers: {'Cache-Control': 'no-store'}},
      )
    }
    if (e instanceof HMRedirectError) {
      const destRedirectUrl = createResourceRedirectUrl(
        e.target,
        (extraData || {}) as RedirectRouteContext,
        originHomeId,
      )
      console.log('[web-loader] redirecting resource route', {
        from: id,
        to: e.target,
        destRedirectUrl,
      })
      return redirect(destRedirectUrl)
    }
    console.error('Error Loading Space Document', id, e)

    let daemonError: GRPCError | undefined = undefined
    if (e instanceof ConnectError) {
      daemonError = {
        message: e.message,
        code: e.code,
      }
    } else if (e instanceof Error && e.message.toLowerCase().includes('permission')) {
      daemonError = {
        message: e.message,
        code: Code.PermissionDenied,
      }
    }

    return wrapJSON(
      {
        id,
        homeMetadata,
        origin,
        originHomeId,
        daemonError,
        metadataId,
        ...(extraData || {}),
      },
      {status: id ? 200 : 404},
    )
  }
}

/**
 * Space header payload for utility pages (profile, connect, etc.)
 * These pages need the home document and directory for navigation but don't
 * have their own document content.
 */
export type SpaceHeaderPayload = {
  originHomeId: UnpackedHypermediaId | undefined
  homeMetadata: HMMetadata | null
  origin: string
  spaceHost: string
  dehydratedState?: DehydratedState
}

/**
 * Load space header data for utility pages.
 * Prefetches home document and directory for navigation rendering via React Query hydration.
 */
export async function loadSpaceHeaderData(parsedRequest: ParsedRequest): Promise<SpaceHeaderPayload> {
  const {hostname, origin} = parsedRequest
  const config = await getConfig(hostname)

  if (!config?.registeredAccountUid) {
    return {
      originHomeId: undefined,
      homeMetadata: null,
      origin,
      spaceHost: origin,
    }
  }

  const homeId = hmId(config.registeredAccountUid, {latest: true})
  const prefetchCtx = createPrefetchContext()
  const client = serverUniversalClient

  try {
    // Prefetch home document and directory for navigation
    await Promise.allSettled([
      prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId)),
      prefetchCtx.queryClient.prefetchQuery(queryDirectory(client, homeId, 'Children')),
    ])

    // Read from cache
    const homeResource = prefetchCtx.queryClient.getQueryData(queryResource(client, homeId).queryKey) as {
      type: 'document'
      document: HMDocument
    } | null
    const homeDocument = homeResource?.type === 'document' ? homeResource.document : null

    return {
      originHomeId: homeId,
      homeMetadata: homeDocument?.metadata || null,
      origin,
      spaceHost: origin,
      dehydratedState: dehydratePrefetchContext(prefetchCtx),
    }
  } catch (e) {
    console.error('Error loading space header data', e)
    // Return minimal data on error
    const metadataResult = await getMetadata(homeId)
    return {
      originHomeId: homeId,
      homeMetadata: metadataResult.metadata,
      origin,
      spaceHost: origin,
    }
  }
}

export type ProfilePagePayload = SpaceHeaderPayload & {
  profileId: UnpackedHypermediaId
  // For SSR meta tags
  profileName: string | null
}

/**
 * Load profile page data with prefetched account data.
 */
export async function loadProfilePageData(
  parsedRequest: ParsedRequest,
  profileUid: string,
): Promise<ProfilePagePayload> {
  const {hostname, origin} = parsedRequest
  const config = await getConfig(hostname)

  const profileId = hmId(profileUid)
  const prefetchCtx = createPrefetchContext()
  const client = serverUniversalClient

  // Prefetch profile account data
  await prefetchCtx.queryClient.prefetchQuery(queryAccount(client, profileUid))

  // Read profile data from cache for SSR meta tags
  const profileData = prefetchCtx.queryClient.getQueryData(queryAccount(client, profileUid).queryKey) as {
    metadata?: {name?: string}
  } | null
  const profileName = profileData?.metadata?.name || null

  if (!config?.registeredAccountUid) {
    return {
      originHomeId: undefined,
      homeMetadata: null,
      origin,
      spaceHost: origin,
      profileId,
      profileName,
      dehydratedState: dehydratePrefetchContext(prefetchCtx),
    }
  }

  const homeId = hmId(config.registeredAccountUid, {latest: true})

  try {
    // Prefetch home document and directory for navigation
    await prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId))
    await prefetchCtx.queryClient.prefetchQuery(queryDirectory(client, homeId, 'Children'))

    // Read from cache
    const homeResource = prefetchCtx.queryClient.getQueryData(queryResource(client, homeId).queryKey) as {
      type: 'document'
      document: HMDocument
    } | null
    const homeDocument = homeResource?.type === 'document' ? homeResource.document : null

    return {
      originHomeId: homeId,
      homeMetadata: homeDocument?.metadata || null,
      origin,
      spaceHost: origin,
      profileId,
      profileName,
      dehydratedState: dehydratePrefetchContext(prefetchCtx),
    }
  } catch (e) {
    console.error('Error loading profile page data', e)
    const metadataResult = await getMetadata(homeId)
    return {
      originHomeId: homeId,
      homeMetadata: metadataResult.metadata,
      origin,
      spaceHost: origin,
      profileId,
      profileName,
      dehydratedState: dehydratePrefetchContext(prefetchCtx),
    }
  }
}
