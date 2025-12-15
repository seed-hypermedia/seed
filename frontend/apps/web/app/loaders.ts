import {toPlainMessage} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {redirect} from '@remix-run/react'
import {
  createWebHMUrl,
  EditorText,
  extractQueryBlocks,
  extractRefs,
  getChildrenType,
  getCommentTargetId,
  getParentPaths,
  HMBlock,
  HMBlockNode,
  hmBlockToEditorBlock,
  HMDocument,
  HMDocumentMetadataSchema,
  hmId,
  hmIdPathToEntityQueryPath,
  HMInlineContent,
  HMLoadedBlock,
  HMLoadedBlockNode,
  HMLoadedInlineEmbedNode,
  HMLoadedLinkNode,
  HMLoadedText,
  HMLoadedTextContentNode,
  HMMetadata,
  HMMetadataPayload,
  HMQueryResult,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {SITE_BASE_URL, WEB_SIGNING_ENABLED} from '@shm/shared/constants'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentSchema,
} from '@shm/shared/hm-types'
import {
  createDirectoryResolver,
  createQueryResolver,
} from '@shm/shared/models/directory'
import {
  documentMetadataParseAdjustments,
  getErrorMessage,
  HMError,
  HMNotFoundError,
  HMRedirectError,
} from '@shm/shared/models/entity'
import {
  createResourceFetcher,
  createResourceResolver,
} from '@shm/shared/resource-loader'
import {getBlockNodeById} from '@shm/ui/blocks-content'
import {DehydratedState} from '@tanstack/react-query'
import {grpcClient} from './client.server'
import {
  queryAccount,
  queryDirectory,
  queryResource,
} from '@shm/shared/models/queries'
import {createPrefetchContext, dehydratePrefetchContext} from './queries.server'
import {serverUniversalClient} from './server-universal-client'
import {ParsedRequest} from './request'
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

const getDirectory = createDirectoryResolver(grpcClient)
const getQueryResults = createQueryResolver(grpcClient)

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

async function loadResourcePayload(
  docId: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
  payload: {
    document: HMDocument
    latestDocument?: HMDocument | null
    comment?: HMComment
  },
): Promise<WebResourcePayload> {
  const {document, latestDocument, comment} = payload
  let authors = await Promise.all(
    document.authors.map(async (authorUid) => {
      return await getMetadata(hmId(authorUid))
    }),
  )
  const refs = extractRefs(document.content)
  let embeddedDocs: {id: UnpackedHypermediaId; document: HMDocument}[] = (
    await Promise.all(
      // @ts-expect-error
      refs.map(async (ref) => {
        try {
          const doc = await resolveHMDocument({
            ...ref.refId,
            // removing version from home document to get the latest site navigation all the time
            version:
              ref.refId.path && ref.refId.path.length > 0
                ? ref.refId.version
                : null,
          })
          if (!doc) return null
          return {document: doc, id: ref.refId}
        } catch (e) {
          console.error('error fetching embeddedDoc', ref, e)
        }
      }),
    )
  ).filter((doc) => !!doc)

  const queryBlocks = extractQueryBlocks(document.content)
  const homeId = hmId(docId.uid, {latest: true, version: undefined})

  const homeDocument = await getDocument(homeId)

  embeddedDocs.push({
    id: homeId,
    document: homeDocument,
  })
  const homeDirectoryResults = await getDirectory(homeId, 'Children')
  const homeDirectoryQuery = {in: homeId, results: homeDirectoryResults}
  const directoryResults = await getDirectory(docId)
  const alreadyEmbeddedDocIds = new Set(embeddedDocs.map((doc) => doc.id.id))
  const embeddedAuthorsUidsToFetch = new Set<string>()
  const queryBlockQueries = (
    await Promise.all(
      queryBlocks.map(async (block) => {
        return await getQueryResults(block.attributes.query)
      }),
    )
  ).filter((result) => !!result)
  embeddedDocs.push(
    ...(await Promise.all(
      queryBlockQueries
        .flatMap((item) => item.results)
        .map(async (item) => {
          const id = item.id
          const document = await getDocument(id)
          document.authors.forEach((author) => {
            if (!alreadyEmbeddedDocIds.has(hmId(author).id)) {
              embeddedAuthorsUidsToFetch.add(author)
            }
          })
          return {
            id,
            document,
          }
        }),
    )),
  )
  // now we need to get the author content for queried docs
  embeddedDocs.push(
    ...(
      await Promise.all(
        Array.from(embeddedAuthorsUidsToFetch).map(async (uid) => {
          try {
            const document = await getDocument(hmId(uid), {
              discover: true,
            })
            return {
              id: hmId(uid),
              document,
            }
          } catch (e) {
            console.error('error fetching author', uid, e)
            return null
          }
        }),
      )
    ).filter((doc) => !!doc),
  )
  const crumbs = getParentPaths(docId.path).slice(0, -1)
  const breadcrumbs = await Promise.all(
    crumbs.map(async (crumbPath) => {
      const id = hmId(docId.uid, {path: crumbPath})
      const metadataPayload = await getMetadata(id)
      return {
        ...metadataPayload,
      }
    }),
  )
  breadcrumbs.push({
    id: docId,
    metadata: document.metadata,
  })

  // Create prefetch context and populate with data for SSR hydration
  const prefetchCtx = createPrefetchContext()
  const client = serverUniversalClient

  // Prefetch critical data with error handling to prevent SSR crashes
  try {
    // Prefetch home document
    await prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId))

    // Prefetch directory queries
    await prefetchCtx.queryClient.prefetchQuery(
      queryDirectory(client, homeId, 'Children'),
    )
    await prefetchCtx.queryClient.prefetchQuery(
      queryDirectory(client, docId, 'Children'),
    )
  } catch (e) {
    console.error('Error prefetching critical data for SSR', e)
    // Continue with degraded state - client will fetch missing data
  }

  // Prefetch all embedded documents (use allSettled for graceful degradation)
  await Promise.allSettled(
    embeddedDocs.map((doc) =>
      prefetchCtx.queryClient.prefetchQuery(queryResource(client, doc.id)),
    ),
  )

  // Prefetch account metadata (use allSettled for graceful degradation)
  await Promise.allSettled(
    authors.map((author) =>
      prefetchCtx.queryClient.prefetchQuery(
        queryAccount(client, author.id.uid),
      ),
    ),
  )

  const dehydratedState = dehydratePrefetchContext(prefetchCtx)

  return {
    document,
    comment,
    accountsMetadata: Object.fromEntries(
      authors.map((author) => [author.id.uid, author]),
    ),
    isLatest: !latestDocument || latestDocument.version === document.version,
    id: {...docId, version: document.version},
    breadcrumbs,
    dehydratedState,
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
): Promise<WebResourcePayload> {
  const resource = await resolveResource(id)
  if (resource.type === 'comment') {
    const comment = resource.comment
    const targetDocId = getCommentTargetId(comment)
    if (!targetDocId) throw new Error('targetDocId not found')
    const document = await getDocument(targetDocId, {discover: true})
    return await loadResourcePayload(targetDocId, parsedRequest, {
      document,
      comment,
    })
  }
  if (resource.type === 'tombstone') {
    throw new Error('Resource has been deleted')
  }
  // resource.type === 'document'
  const document = resource.document
  const latestDocument = await getLatestDocument(id)
  return await loadResourcePayload(id, parsedRequest, {
    document,
    latestDocument,
  })
}

// High-level loader with discovery fallback - tries to discover if not found
export async function loadResourceWithDiscovery(
  id: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
): Promise<WebResourcePayload> {
  try {
    return await loadResource(id, parsedRequest)
  } catch (e) {
    if (e instanceof HMNotFoundError) {
      const discovered = await discoverDocument(
        id.uid,
        id.path || [],
        id.version || undefined,
        id.latest,
      )
      if (discovered) {
        return await loadResource(id, parsedRequest)
      }
    }
    throw e
  }
}

function textNodeAttributes(
  node: EditorText,
): Partial<HMLoadedTextContentNode> {
  const attributes: Partial<HMLoadedTextContentNode> = {}
  if (node.styles.bold) attributes.bold = true
  if (node.styles.italic) attributes.italic = true
  if (node.styles.underline) attributes.underline = true
  if (node.styles.strike) attributes.strike = true
  if (node.styles.code) attributes.code = true
  return attributes
}

async function loadEditorNodes(
  nodes: HMInlineContent[],
): Promise<HMLoadedText> {
  const content = await Promise.all(
    nodes.map(async (editorNode) => {
      if (editorNode.type === 'inline-embed') {
        const id = unpackHmId(editorNode.link)
        if (!id)
          return {
            type: 'InlineEmbed',
            ref: editorNode.link,
            text: null,
            id: null,
          } satisfies HMLoadedInlineEmbedNode
        try {
          const document = await getDocument(id)
          return {
            type: 'InlineEmbed',
            ref: editorNode.link,
            id,
            text: document.metadata.name || '(?)',
          } satisfies HMLoadedInlineEmbedNode
        } catch (e) {
          console.error('Error loading inline embed', editorNode, e)
          return {
            type: 'InlineEmbed',
            ref: editorNode.link,
            text: null,
            id,
          } satisfies HMLoadedInlineEmbedNode
        }
      }
      if (editorNode.type === 'text') {
        return {
          type: 'Text',
          text: editorNode.text,
          ...textNodeAttributes(editorNode),
        } satisfies HMLoadedTextContentNode
      }
      if (editorNode.type === 'link') {
        return {
          type: 'Link',
          link: editorNode.href,
          content: editorNode.content
            .map((node) => {
              if (node.type === 'inline-embed') return null
              if (node.type === 'link') return null
              return {
                type: 'Text',
                text: node.text,
                ...textNodeAttributes(node),
              } satisfies HMLoadedTextContentNode
            })
            .filter((node) => !!node),
        } satisfies HMLoadedLinkNode
      }
      console.log('Unhandled editor node', editorNode)
      return null
    }),
  )
  return content.filter((node) => !!node)
}

async function loadDocumentBlock(block: HMBlock): Promise<HMLoadedBlock> {
  if (block.type === 'Paragraph') {
    const editorBlock = hmBlockToEditorBlock(block)
    if (editorBlock.type !== 'paragraph')
      throw new Error('Unexpected situation with paragraph block conversion')
    const content = await loadEditorNodes(editorBlock.content)
    return {
      type: 'Paragraph',
      id: block.id,
      content,
    }
  }
  if (block.type === 'Heading') {
    const editorBlock = hmBlockToEditorBlock(block)
    if (editorBlock.type !== 'heading')
      throw new Error('Unexpected situation with heading block conversion')
    const content = await loadEditorNodes(editorBlock.content)
    return {
      type: 'Heading',
      id: block.id,
      content,
    }
  }
  if (block.type === 'Embed') {
    const id = unpackHmId(block.link)
    if (!id) {
      return {
        type: 'Embed',
        id: block.id,
        link: block.link,
        authors: {},
        view: block.attributes.view,
        updateTime: null,
        metadata: null,
        content: null,
      }
    }
    try {
      const document = await getDocument(id)
      const selectedBlock = id.blockRef
        ? getBlockNodeById(document.content, id.blockRef)
        : null
      const selectedContent = selectedBlock ? [selectedBlock] : document.content
      if (!selectedContent) {
        return {
          type: 'Embed',
          id: block.id,
          link: block.link,
          authors: await loadAuthors(document.authors),
          view: block.attributes.view,
          updateTime: document.updateTime,
          metadata: document.metadata,
          content: null,
        }
      }
      return {
        type: 'Embed',
        id: block.id,
        link: block.link,
        authors: await loadAuthors(document.authors),
        view: block.attributes.view,
        updateTime: document.updateTime,
        metadata: document.metadata,
        content: await loadDocumentContent(selectedContent),
      }
    } catch (e) {
      console.error('Error loading embed', block, e)
      return {
        type: 'Embed',
        id: block.id,
        link: block.link,
        authors: {},
        view: block.attributes.view,
        updateTime: null,
        metadata: null,
        content: null,
      }
    }
  }
  if (block.type === 'Video') {
    return {
      type: 'Video',
      id: block.id,
      link: block.link,
      name: block.attributes.name,
      width: block.attributes.width,
    }
  }
  if (block.type === 'File') {
    return {
      type: 'File',
      id: block.id,
      link: block.link,
      name: block.attributes.name,
      size: block.attributes.size,
    }
  }
  if (block.type === 'Image') {
    return {
      type: 'Image',
      id: block.id,
      link: block.link,
      name: block.attributes.name,
      width: block.attributes.width,
    }
  }
  if (block.type === 'Query') {
    const q = await getQueryResults(block.attributes.query)
    return {
      type: 'Query',
      id: block.id,
      query: block.attributes.query,
      results: q?.results,
    }
  }
  return {
    type: 'Unsupported',
    id: block.id,
  }
}

async function loadDocumentBlockNode(
  blockNode: HMBlockNode,
): Promise<HMLoadedBlockNode> {
  const childrenType = getChildrenType(blockNode.block)
  const outputBlockNode: HMLoadedBlockNode = {
    block: await loadDocumentBlock(blockNode.block),
    children: await loadDocumentContent(blockNode.children),
  }
  if (childrenType) {
    outputBlockNode.childrenType = childrenType
  }
  return outputBlockNode
}

async function loadDocumentContent(
  blockNodes: undefined | HMBlockNode[],
): Promise<HMLoadedBlockNode[]> {
  if (!blockNodes) return []
  return await Promise.all(blockNodes.map(loadDocumentBlockNode))
}

export async function loadAuthors(
  authors: string[],
): Promise<HMAccountsMetadata> {
  const accountMetas = await Promise.all(
    authors.map(async (author) => {
      const metadata = await getMetadata(hmId(author))
      return {
        [author]: metadata,
      }
    }),
  )
  return Object.fromEntries(
    accountMetas.map((meta) => {
      const key = Object.keys(meta)[0]
      // @ts-expect-error
      return [key, meta[key]]
    }),
  )
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

export async function loadSiteResource<T>(
  parsedRequest: ParsedRequest,
  id: UnpackedHypermediaId,
  extraData?: T,
): Promise<WrappedResponse<SiteDocumentPayload & T>> {
  const {hostname, origin} = parsedRequest
  const config = await getConfig(hostname)
  if (!config) {
    throw new Error('No config found for hostname ' + hostname)
  }
  let homeMetadata = null
  let originHomeId: undefined | UnpackedHypermediaId = undefined
  if (config.registeredAccountUid) {
    try {
      const {id, metadata} = await getMetadata(
        hmId(config.registeredAccountUid),
      )
      homeMetadata = metadata
      originHomeId = id
    } catch (e) {}
  }
  try {
    const resourceContent = await loadResourceWithDiscovery(id, parsedRequest)
    const loadedSiteDocument = {
      ...(extraData || {}),
      ...resourceContent,
      homeMetadata,
      origin,
      originHomeId,
    }
    const headers: Record<string, string> = {}
    headers['x-hypermedia-id'] = id.id
    headers['x-hypermedia-version'] = resourceContent.document.version
    return wrapJSON(loadedSiteDocument, {
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
