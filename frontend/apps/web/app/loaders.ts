import {toPlainMessage} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {redirect} from '@remix-run/react'
import {
  createWebHMUrl,
  entityQueryPathToHmIdPath,
  extractQueryBlocks,
  extractRefs,
  getCommentTargetId,
  getParentPaths,
  HMDocument,
  HMDocumentMetadataSchema,
  hmId,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  HMMetadataPayload,
  packHmId,
  queryBlockSortedItems,
  UnpackedHypermediaId,
} from '@shm/shared'
import {SITE_BASE_URL, WEB_SIGNING_ENABLED} from '@shm/shared/constants'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentSchema,
  HMDocumentInfo,
  HMResource,
} from '@shm/shared/hm-types'
import {
  documentMetadataParseAdjustments,
  getErrorMessage,
  HMError,
  HMNotFoundError,
  HMRedirectError,
} from '@shm/shared/models/entity'
import {
  queryAccount,
  queryDirectory,
  queryInteractionSummary,
  queryResource,
} from '@shm/shared/models/queries'
import {
  createResourceFetcher,
  createResourceResolver,
} from '@shm/shared/resource-loader'
import {DehydratedState} from '@tanstack/react-query'
import {grpcClient} from './client.server'
import {instrument, InstrumentationContext} from './instrumentation.server'
import {
  createPrefetchContext,
  dehydratePrefetchContext,
  PrefetchContext,
} from './queries.server'
import {ParsedRequest} from './request'
import {serverUniversalClient} from './server-universal-client'
import {getConfig} from './site-config.server'
import {discoverDocument} from './utils/discovery'
import {wrapJSON, WrappedResponse} from './wrapping.server'

export async function getMetadata(
  id: UnpackedHypermediaId,
): Promise<HMMetadataPayload> {
  try {
    const rawDoc = await grpcClient.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: id.latest ? undefined : id.version || undefined,
    })
    const metadataJSON = rawDoc.metadata?.toJson({emitDefaultValues: true})
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
    const serverAccount = toPlainMessage(grpcAccount)
    if (serverAccount.aliasAccount) {
      return await getAccount(serverAccount.aliasAccount)
    }
    const serverMetadata = grpcAccount.metadata?.toJson() || {}
    const metadata = HMDocumentMetadataSchema.parse(serverMetadata)
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
    return HMCommentSchema.parse(rawDoc.toJson())
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

  // supporting metadata for referenced accounts
  accountsMetadata: HMAccountsMetadata
  siteHost: string | undefined
  isLatest: boolean
  breadcrumbs: Array<HMMetadataPayload>

  // Icon from the document's home (for favicon in SSR)
  siteHomeIcon?: string | null

  // Dehydrated React Query state for SSR hydration
  dehydratedState?: DehydratedState
}

export async function getDocument(
  resourceId: UnpackedHypermediaId,
  {discover}: {discover?: boolean} = {},
): Promise<HMDocument> {
  const {version, uid, latest} = resourceId
  if (discover && false) {
    // @ts-expect-error
    return await discoverDocument(
      uid,
      resourceId.path || [],
      version || undefined,
      latest,
    )
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
  const enableWebSigning =
    WEB_SIGNING_ENABLED && parsedRequest.origin === SITE_BASE_URL

  return {
    enableWebSigning,
    siteHost: parsedRequest.origin,
    origin: parsedRequest.origin,
  }
}

async function getLatestDocument(resourceId: UnpackedHypermediaId) {
  const latestDocument =
    !!resourceId.version && !resourceId.latest
      ? await getDocument(
          {...resourceId, latest: true, version: null},
          {discover: true},
        )
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

  // Wave 1: Core navigation data (parallel, no dependencies)
  await instrument(ctx || noopCtx, 'prefetchWave1', () =>
    Promise.allSettled([
      instrument(ctx || noopCtx, `prefetchResource(${packHmId(docId)})`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryResource(client, docId)),
      ),
      instrument(ctx || noopCtx, `prefetchResource(${packHmId(homeId)})`, () =>
        prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId)),
      ),
      instrument(
        ctx || noopCtx,
        `prefetchDirectory(${packHmId(homeId)}, Children)`,
        () =>
          prefetchCtx.queryClient.prefetchQuery(
            queryDirectory(client, homeId, 'Children'),
          ),
      ),
      // AllDescendants for breadcrumb metadata (covers all nested paths)
      instrument(
        ctx || noopCtx,
        `prefetchDirectory(${packHmId(homeId)}, AllDescendants)`,
        () =>
          prefetchCtx.queryClient.prefetchQuery(
            queryDirectory(client, homeId, 'AllDescendants'),
          ),
      ),
      instrument(
        ctx || noopCtx,
        `prefetchDirectory(${packHmId(docId)}, Children)`,
        () =>
          prefetchCtx.queryClient.prefetchQuery(
            queryDirectory(client, docId, 'Children'),
          ),
      ),
      instrument(
        ctx || noopCtx,
        `prefetchInteractionSummary(${packHmId(docId)})`,
        () =>
          prefetchCtx.queryClient.prefetchQuery(
            queryInteractionSummary(client, docId),
          ),
      ),
    ]),
  )

  // Wave 2: Content dependencies (parallel, depends on document content)
  const queryBlocks = extractQueryBlocks(document.content)
  const refs = extractRefs(document.content)

  await instrument(ctx || noopCtx, 'prefetchWave2', () =>
    Promise.allSettled([
      // Query block directories
      ...queryBlocks.map((block) => {
        const include = block.attributes.query.includes[0]
        if (!include) return Promise.resolve()
        const targetId = hmId(include.space, {
          path: entityQueryPathToHmIdPath(include.path),
        })
        return instrument(
          ctx || noopCtx,
          `prefetchQueryDirectory(${packHmId(targetId)})`,
          () =>
            prefetchCtx.queryClient.prefetchQuery(
              queryDirectory(client, targetId, include.mode),
            ),
        )
      }),
      // Embedded document content
      ...refs.map((ref) =>
        instrument(
          ctx || noopCtx,
          `prefetchEmbedResource(${packHmId(ref.refId)})`,
          () =>
            prefetchCtx.queryClient.prefetchQuery(
              queryResource(client, ref.refId),
            ),
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

  // Wave 3: Card-view query block resources (depends on Wave 2 directory data)
  const cardViewQueryBlocks = queryBlocks.filter(
    (block) => block.attributes.style === 'Card',
  )

  if (cardViewQueryBlocks.length > 0) {
    await instrument(ctx || noopCtx, 'prefetchWave3', async () => {
      const resourceIds: UnpackedHypermediaId[] = []

      for (const block of cardViewQueryBlocks) {
        const include = block.attributes.query.includes[0]
        if (!include) continue

        const targetId = hmId(include.space, {
          path: entityQueryPathToHmIdPath(include.path),
        })

        // Get directory data from Wave 2 cache
        const directoryData = prefetchCtx.queryClient.getQueryData(
          queryDirectory(client, targetId, include.mode).queryKey,
        ) as HMDocumentInfo[] | null

        if (!directoryData) continue

        // Apply same sort/limit logic as client (reuse queryBlockSortedItems)
        const querySort = block.attributes.query.sort
        const sorted = querySort
          ? queryBlockSortedItems({entries: directoryData, sort: querySort})
          : queryBlockSortedItems({
              entries: directoryData,
              sort: [{term: 'UpdateTime', reverse: false}],
            })

        const queryLimit = block.attributes.query.limit
        const limited =
          queryLimit && queryLimit > 0 ? sorted.slice(0, queryLimit) : sorted

        // Collect resource IDs to prefetch
        limited.forEach((item) => resourceIds.push(item.id))
      }

      // Prefetch all card resources in parallel
      await Promise.allSettled(
        resourceIds.map((id) =>
          instrument(
            ctx || noopCtx,
            `prefetchCardResource(${packHmId(id)})`,
            () =>
              prefetchCtx.queryClient.prefetchQuery(queryResource(client, id)),
          ),
        ),
      )
    })
  }
}

/**
 * Extract home document from the prefetch cache.
 */
function getHomeDocumentFromCache(
  prefetchCtx: PrefetchContext,
  homeId: UnpackedHypermediaId,
): HMDocument | null {
  const client = serverUniversalClient
  const resource = prefetchCtx.queryClient.getQueryData(
    queryResource(client, homeId).queryKey,
  ) as HMResource | null
  return resource?.type === 'document' ? resource.document : null
}

/**
 * Build breadcrumbs from directory cache instead of individual metadata fetches.
 * Uses AllDescendants directory which contains all documents in the account.
 */
function buildBreadcrumbsFromCache(
  prefetchCtx: PrefetchContext,
  docId: UnpackedHypermediaId,
  document: HMDocument,
): HMMetadataPayload[] {
  const client = serverUniversalClient
  const homeId = hmId(docId.uid, {latest: true})

  // Use AllDescendants which contains all documents (including intermediate parents)
  const allDescendants = prefetchCtx.queryClient.getQueryData(
    queryDirectory(client, homeId, 'AllDescendants').queryKey,
  ) as HMDocumentInfo[] | null

  const crumbPaths = getParentPaths(docId.path).slice(0, -1)
  const breadcrumbs = crumbPaths.map((crumbPath) => {
    const id = hmId(docId.uid, {path: crumbPath})
    const dirEntry = allDescendants?.find((d) => d.id.id === id.id)
    return {
      id,
      metadata: dirEntry?.metadata || {},
    }
  })

  // Add current document
  breadcrumbs.push({id: docId, metadata: document.metadata})
  return breadcrumbs
}

/**
 * Build accounts metadata from prefetch cache.
 */
function buildAccountsMetadataFromCache(
  prefetchCtx: PrefetchContext,
  authorUids: string[],
): HMAccountsMetadata {
  const client = serverUniversalClient
  return Object.fromEntries(
    authorUids.map((uid) => {
      const account = prefetchCtx.queryClient.getQueryData(
        queryAccount(client, uid).queryKey,
      ) as HMMetadataPayload | null
      return [uid, account || {id: hmId(uid), metadata: {}}]
    }),
  )
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
  },
  ctx?: InstrumentationContext,
): Promise<WebResourcePayload> {
  const {document, latestDocument, comment} = payload
  const prefetchCtx = createPrefetchContext()
  const homeId = hmId(docId.uid, {latest: true})

  // Single prefetch phase - React Query handles deduplication
  await prefetchResourceData(docId, document, prefetchCtx, ctx)

  // Extract data from cache for SSR response
  const homeDocument = getHomeDocumentFromCache(prefetchCtx, homeId)
  const breadcrumbs = buildBreadcrumbsFromCache(prefetchCtx, docId, document)
  const accountsMetadata = buildAccountsMetadataFromCache(
    prefetchCtx,
    document.authors,
  )

  return {
    document,
    comment,
    accountsMetadata,
    isLatest: !latestDocument || latestDocument.version === document.version,
    id: {...docId, version: document.version},
    breadcrumbs,
    siteHomeIcon: homeDocument?.metadata?.icon || null,
    dehydratedState: dehydratePrefetchContext(prefetchCtx),
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
): Promise<WebResourcePayload> {
  const noopCtx = {
    enabled: false,
    requestPath: '',
    requestMethod: '',
    root: {name: '', start: 0, children: []},
    current: {name: '', start: 0, children: []},
  } as InstrumentationContext

  const resource = await instrument(
    ctx || noopCtx,
    `resolveResource(${packHmId(id)})`,
    () => resolveResource(id),
  )
  if (resource.type === 'comment') {
    const comment = resource.comment
    const targetDocId = getCommentTargetId(comment)
    if (!targetDocId) throw new Error('targetDocId not found')
    const document = await instrument(
      ctx || noopCtx,
      `getDocument(comment:${packHmId(targetDocId)})`,
      () => getDocument(targetDocId, {discover: true}),
    )
    return await loadResourcePayload(
      targetDocId,
      parsedRequest,
      {
        document,
        comment,
      },
      ctx,
    )
  }
  if (resource.type === 'tombstone') {
    throw new Error('Resource has been deleted')
  }
  // resource.type === 'document'
  const document = resource.document
  const latestDocument = await instrument(
    ctx || noopCtx,
    `getLatestDocument(${packHmId(id)})`,
    () => getLatestDocument(id),
  )
  return await loadResourcePayload(
    id,
    parsedRequest,
    {
      document,
      latestDocument,
    },
    ctx,
  )
}

// High-level loader with discovery fallback - tries to discover if not found
export async function loadResourceWithDiscovery(
  id: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
  ctx?: InstrumentationContext,
): Promise<WebResourcePayload> {
  const noopCtx = {
    enabled: false,
    requestPath: '',
    requestMethod: '',
    root: {name: '', start: 0, children: []},
    current: {name: '', start: 0, children: []},
  } as InstrumentationContext

  try {
    return await loadResource(id, parsedRequest, ctx)
  } catch (e) {
    if (e instanceof HMNotFoundError) {
      const discovered = await instrument(
        ctx || noopCtx,
        `discoverDocument(${packHmId(id)})`,
        () =>
          discoverDocument(
            id.uid,
            id.path || [],
            id.version || undefined,
            id.latest,
          ),
      )
      if (discovered) {
        return await loadResource(id, parsedRequest, ctx)
      }
    }
    throw e
  }
}

export type SiteDocumentPayload = WebResourcePayload & {
  homeMetadata: HMMetadata
  originHomeId: UnpackedHypermediaId
  origin: string
  comment?: HMComment
  daemonError?: GRPCError
  feed?: boolean
}

// We have to define our own error type here instead of using the ConnectError type,
// because for some reason the code gets stripped away when data is passed from the loader to the component,
// probably due to superjson serialization.
export type GRPCError = {
  message: string
  code: Code
}

export async function loadSiteResource<
  T extends Record<string, unknown> = Record<string, never>,
>(
  parsedRequest: ParsedRequest,
  id: UnpackedHypermediaId,
  extraData?: T & {instrumentationCtx?: InstrumentationContext},
): Promise<
  WrappedResponse<SiteDocumentPayload & Omit<T, 'instrumentationCtx'>>
> {
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
      const result = await instrument(
        ctx || noopCtx,
        `getHomeMetadata(${packHmId(homeId)})`,
        () => getMetadata(homeId),
      )
      homeMetadata = result.metadata
      originHomeId = result.id
    } catch (e) {}
  }
  try {
    const resourceContent = await instrument(
      ctx || noopCtx,
      `loadResourceWithDiscovery(${packHmId(id)})`,
      () => loadResourceWithDiscovery(id, parsedRequest, ctx),
    )
    const loadedSiteDocument = {
      ...(extraData || {}),
      ...resourceContent,
      homeMetadata,
      origin,
      originHomeId,
    }
    // Remove instrumentationCtx from the response
    const {instrumentationCtx: _, ...cleanDocument} = loadedSiteDocument as any
    const headers: Record<string, string> = {}
    headers['x-hypermedia-id'] = id.id
    headers['x-hypermedia-version'] = resourceContent.document.version
    return wrapJSON(cleanDocument, {
      headers,
    })
  } catch (e) {
    console.error('Error Loading Site Document', id, e)
    if (e instanceof HMRedirectError) {
      const destRedirectUrl = createWebHMUrl(e.target.uid, {
        path: e.target.path,
        version: e.target.version,
        latest: e.target.latest,
        blockRef: e.target.blockRef,
        blockRange: e.target.blockRange,
        originHomeId,
        hostname: null,
      })
      return redirect(destRedirectUrl)
    }

    let daemonError: GRPCError | undefined = undefined
    if (e instanceof ConnectError) {
      daemonError = {
        message: e.message,
        code: e.code,
      }
    }

    return wrapJSON(
      {
        id,
        homeMetadata,
        origin,
        originHomeId,
        daemonError,
        ...(extraData || {}),
      },
      {status: id ? 200 : 404},
    )
  }
}

/**
 * Site header payload for utility pages (profile, device-link, connect, etc.)
 * These pages need the home document and directory for navigation but don't
 * have their own document content.
 */
export type SiteHeaderPayload = {
  originHomeId: UnpackedHypermediaId | undefined
  homeMetadata: HMMetadata | null
  origin: string
  siteHost: string
  dehydratedState?: DehydratedState
}

/**
 * Load site header data for utility pages.
 * Prefetches home document and directory for navigation rendering via React Query hydration.
 */
export async function loadSiteHeaderData(
  parsedRequest: ParsedRequest,
): Promise<SiteHeaderPayload> {
  const {hostname, origin} = parsedRequest
  const config = await getConfig(hostname)

  if (!config?.registeredAccountUid) {
    return {
      originHomeId: undefined,
      homeMetadata: null,
      origin,
      siteHost: origin,
    }
  }

  const homeId = hmId(config.registeredAccountUid, {latest: true})
  const prefetchCtx = createPrefetchContext()
  const client = serverUniversalClient

  try {
    // Prefetch home document and directory for navigation
    await Promise.allSettled([
      prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId)),
      prefetchCtx.queryClient.prefetchQuery(
        queryDirectory(client, homeId, 'Children'),
      ),
    ])

    // Read from cache
    const homeResource = prefetchCtx.queryClient.getQueryData(
      queryResource(client, homeId).queryKey,
    ) as {type: 'document'; document: HMDocument} | null
    const homeDocument =
      homeResource?.type === 'document' ? homeResource.document : null

    return {
      originHomeId: homeId,
      homeMetadata: homeDocument?.metadata || null,
      origin,
      siteHost: origin,
      dehydratedState: dehydratePrefetchContext(prefetchCtx),
    }
  } catch (e) {
    console.error('Error loading site header data', e)
    // Return minimal data on error
    const metadataResult = await getMetadata(homeId)
    return {
      originHomeId: homeId,
      homeMetadata: metadataResult.metadata,
      origin,
      siteHost: origin,
    }
  }
}

export type ProfilePagePayload = SiteHeaderPayload & {
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
  const profileData = prefetchCtx.queryClient.getQueryData(
    queryAccount(client, profileUid).queryKey,
  ) as {metadata?: {name?: string}} | null
  const profileName = profileData?.metadata?.name || null

  if (!config?.registeredAccountUid) {
    return {
      originHomeId: undefined,
      homeMetadata: null,
      origin,
      siteHost: origin,
      profileId,
      profileName,
      dehydratedState: dehydratePrefetchContext(prefetchCtx),
    }
  }

  const homeId = hmId(config.registeredAccountUid, {latest: true})

  try {
    // Prefetch home document and directory for navigation
    await prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId))
    await prefetchCtx.queryClient.prefetchQuery(
      queryDirectory(client, homeId, 'Children'),
    )

    // Read from cache
    const homeResource = prefetchCtx.queryClient.getQueryData(
      queryResource(client, homeId).queryKey,
    ) as {type: 'document'; document: HMDocument} | null
    const homeDocument =
      homeResource?.type === 'document' ? homeResource.document : null

    return {
      originHomeId: homeId,
      homeMetadata: homeDocument?.metadata || null,
      origin,
      siteHost: origin,
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
      siteHost: origin,
      profileId,
      profileName,
      dehydratedState: dehydratePrefetchContext(prefetchCtx),
    }
  }
}
