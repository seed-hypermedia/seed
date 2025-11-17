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
  packHmId,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {SITE_BASE_URL, WEB_SIGNING_ENABLED} from '@shm/shared/constants'
import {prepareHMComment, prepareHMDocument} from '@shm/shared/document-utils'
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentSchema,
  HMResourceComment,
  HMResourceDocument,
  HMResourceNotFound,
  HMResourceRedirect,
} from '@shm/shared/hm-types'
import {
  getDiretoryWithClient,
  getQueryResultsWithClient,
} from '@shm/shared/models/directory'
import {
  documentMetadataParseAdjustments,
  getErrorMessage,
  HMRedirectError,
} from '@shm/shared/models/entity'
import {createResourceLoader} from '@shm/shared/resource-loader'
import {getBlockNodeById} from '@shm/ui/blocks-content'
import {grpcClient} from './client.server'
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
  supportDocuments?: {id: UnpackedHypermediaId; document: HMDocument}[]
  supportQueries?: HMQueryResult[]
  isLatest: boolean
  breadcrumbs: Array<HMMetadataPayload>
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
  const apiDoc = await grpcClient.documents
    .getDocument({
      account: uid,
      path,
      version: latest ? undefined : version || '',
    })
    .catch((e) => {
      const error = getErrorMessage(e)
      if (error instanceof HMRedirectError) {
        // console.error('~~ HMRedirectError to', error.target)
        return error
      }
      throw e
    })
  if (apiDoc instanceof HMRedirectError) {
    throw apiDoc
  }
  return prepareHMDocument(apiDoc)
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

const getDirectory = getDiretoryWithClient(grpcClient)
const getQueryResults = getQueryResultsWithClient(grpcClient)

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
  let supportDocuments: {id: UnpackedHypermediaId; document: HMDocument}[] = (
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
          console.error('error fetching supportDocument', ref, e)
        }
      }),
    )
  ).filter((doc) => !!doc)

  const queryBlocks = extractQueryBlocks(document.content)
  const homeId = hmId(docId.uid, {latest: true, version: undefined})

  const homeDocument = await getDocument(homeId)

  supportDocuments.push({
    id: homeId,
    document: homeDocument,
  })
  const homeDirectoryResults = await getDirectory(homeId, 'Children')
  const homeDirectoryQuery = {in: homeId, results: homeDirectoryResults}
  const directoryResults = await getDirectory(docId)
  const alreadySupportDocIds = new Set(supportDocuments.map((doc) => doc.id.id))
  const supportAuthorsUidsToFetch = new Set<string>()
  const queryBlockQueries = (
    await Promise.all(
      queryBlocks.map(async (block) => {
        return await getQueryResults(block.attributes.query)
      }),
    )
  ).filter((result) => !!result)
  const supportQueries: HMQueryResult[] = [
    homeDirectoryQuery,
    {in: docId, results: directoryResults},
    ...queryBlockQueries,
  ]
  supportDocuments.push(
    ...(await Promise.all(
      queryBlockQueries
        .flatMap((item) => item.results)
        .map(async (item) => {
          const id = hmId(item.account, {path: item.path})
          const document = await getDocument(id)
          document.authors.forEach((author) => {
            if (!alreadySupportDocIds.has(hmId(author).id)) {
              supportAuthorsUidsToFetch.add(author)
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
  supportDocuments.push(
    ...(
      await Promise.all(
        Array.from(supportAuthorsUidsToFetch).map(async (uid) => {
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

  return {
    document,
    comment,
    supportDocuments,
    supportQueries,
    accountsMetadata: Object.fromEntries(
      authors.map((author) => [author.id.uid, author]),
    ),
    isLatest: !latestDocument || latestDocument.version === document.version,
    id: {...docId, version: document.version},
    breadcrumbs,
    ...getOriginRequestData(parsedRequest),
  }
}

export async function getResource(id: UnpackedHypermediaId) {
  try {
    const resource = await grpcClient.resources.getResource({
      iri: packHmId(id),
    })
    if (resource.kind.case === 'comment') {
      return {
        type: 'comment',
        id,
        comment: prepareHMComment(resource.kind.value),
      } satisfies HMResourceComment
    }
    if (resource.kind.case === 'document') {
      return {
        type: 'document',
        id,
        document: prepareHMDocument(resource.kind.value),
      } satisfies HMResourceDocument
    }
    throw new Error(`Unsupported resource kind: ${resource.kind.case}`)
  } catch (e) {
    const err = getErrorMessage(e)
    if (err instanceof HMRedirectError) {
      return {
        type: 'redirect',
        id,
        redirectTarget: err.target,
      } satisfies HMResourceRedirect
    }
    return {
      type: 'not-found',
      id,
    } satisfies HMResourceNotFound
  }
}

// we should merge this with the createResourceLoader function, but it does a few extra things right now:
export async function loadResource(
  id: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
): Promise<WebResourcePayload> {
  try {
    const resource = await grpcClient.resources.getResource({
      iri: packHmId(id),
    })
    if (resource.kind.case === 'comment') {
      const comment = prepareHMComment(resource.kind.value)
      const targetDocId = getCommentTargetId(comment)
      if (!targetDocId) throw new Error('targetDocId not found')
      const document = await getDocument(targetDocId, {discover: true})
      return await loadResourcePayload(targetDocId, parsedRequest, {
        document,
        comment,
      })
    } else if (resource.kind.case === 'document') {
      const document = prepareHMDocument(resource.kind.value)
      const latestDocument = await getLatestDocument(id)
      return await loadResourcePayload(id, parsedRequest, {
        document,
        latestDocument,
      })
    }
    throw new Error(`Unable to get resource with kind: ${resource.kind.case}`)
  } catch (e) {
    const err = getErrorMessage(e)
    if (err instanceof HMRedirectError) {
      throw err
    }
    throw e
  }
}

const newLoadResource = createResourceLoader(grpcClient)

export async function loadResolvedResource(id: UnpackedHypermediaId) {
  const resource = await newLoadResource(id)
  if (resource.type === 'redirect') {
    return await loadResolvedResource(resource.redirectTarget)
  }
  return resource
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
      results: q?.results
        ? await Promise.all(
            q.results.map(async (result) => ({
              ...result,
              authors: await loadAuthors(result.authors),
            })),
          )
        : null,
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
    const resourceContent = await loadResource(id, parsedRequest)
    let supportQueries = resourceContent.supportQueries
    const loadedSiteDocument = {
      ...(extraData || {}),
      ...resourceContent,
      homeMetadata,
      supportQueries,
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

    // Load home document and directory for the header to render properly
    let supportDocuments: {id: UnpackedHypermediaId; document: HMDocument}[] =
      []
    let supportQueries: HMQueryResult[] = []
    if (config.registeredAccountUid) {
      try {
        const homeId = hmId(config.registeredAccountUid, {
          latest: true,
          version: undefined,
        })
        const homeDocument = await getDocument(homeId)
        supportDocuments.push({
          id: homeId,
          document: homeDocument,
        })
        const homeDirectoryResults = await getDirectory(homeId, 'Children')
        supportQueries.push({in: homeId, results: homeDirectoryResults})
      } catch (homeError) {
        console.error('Error loading home document for error page', homeError)
      }
    }

    return wrapJSON(
      {
        id,
        homeMetadata,
        origin,
        originHomeId,
        daemonError,
        supportDocuments,
        supportQueries,
        ...(extraData || {}),
      },
      {status: id ? 200 : 404},
    )
  }
}
