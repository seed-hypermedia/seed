import {toPlainMessage} from '@bufbuild/protobuf'
import {redirect} from '@remix-run/react'
import {
  createWebHMUrl,
  EditorText,
  extractQueryBlocks,
  extractRefs,
  getParentPaths,
  HMBlock,
  HMBlockChildrenType,
  HMBlockNode,
  hmBlockToEditorBlock,
  HMDocument,
  HMDocumentMetadataSchema,
  HMDocumentSchema,
  hmId,
  hmIdPathToEntityQueryPath,
  HMInlineContent,
  HMLoadedBlock,
  HMLoadedBlockNode,
  HMLoadedDocument,
  HMLoadedInlineEmbedNode,
  HMLoadedLinkNode,
  HMLoadedText,
  HMLoadedTextContentNode,
  HMMetadata,
  HMMetadataPayload,
  HMQueryResult,
  SITE_BASE_URL,
  UnpackedHypermediaId,
  unpackHmId,
  WEB_SIGNING_ENABLED,
} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentSchema,
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
import {getBlockNodeById} from '@shm/ui/document-content'
import {queryClient} from './client'
import {ParsedRequest} from './request'
import {getConfig} from './site-config'
import {discoverDocument} from './utils/discovery'
import {wrapJSON, WrappedResponse} from './wrapping'

export async function getMetadata(
  id: UnpackedHypermediaId,
): Promise<HMMetadataPayload> {
  try {
    const rawDoc = await queryClient.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: id.latest ? undefined : id.version || undefined,
    })
    const metadataJSON = rawDoc.metadata?.toJson({emitDefaultValues: true})
    documentMetadataParseAdjustments(metadataJSON)
    return {
      id,
      metadata: HMDocumentMetadataSchema.parse(metadataJSON),
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
    if (discover) {
      await discoverDocument(accountUid, [], undefined)
    }
    const grpcAccount = await queryClient.documents.getAccount({
      id: accountUid,
    })
    const serverAccount = toPlainMessage(grpcAccount)
    if (serverAccount.aliasAccount) {
      return await getAccount(serverAccount.aliasAccount)
    }
    const serverMetadata = grpcAccount.metadata?.toJson() || {}
    const metadata = HMDocumentMetadataSchema.parse(serverMetadata)
    return {
      id: hmId('d', accountUid),
      metadata,
    } as HMMetadataPayload
  } catch (e) {
    return {id: hmId('d', accountUid), metadata: {}}
  }
}

export async function getComment(id: string): Promise<HMComment> {
  const rawDoc = await queryClient.comments.getComment({
    id,
  })
  return HMCommentSchema.parse(rawDoc.toJson())
}

export type WebBaseDocumentPayload = {
  document: HMDocument
  accountsMetadata: HMAccountsMetadata
  id: UnpackedHypermediaId
  siteHost: string | undefined
  supportDocuments?: {id: UnpackedHypermediaId; document: HMDocument}[]
  supportQueries?: HMQueryResult[]
  enableWebSigning?: boolean
  isLatest: boolean
}

export type WebDocumentPayload = WebBaseDocumentPayload & {
  breadcrumbs: Array<{id: UnpackedHypermediaId; metadata: HMMetadata}>
}

export async function getHMDocument(
  entityId: UnpackedHypermediaId,
  {discover}: {discover?: boolean} = {},
) {
  const {version, uid, latest} = entityId
  if (discover) {
    await discoverDocument(
      uid,
      entityId.path || [],
      version || undefined,
      latest,
    )
  }
  const path = hmIdPathToEntityQueryPath(entityId.path)
  const apiDoc = await queryClient.documents
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
  const docJSON = apiDoc.toJson() as any
  documentMetadataParseAdjustments(docJSON.metadata)
  const document = HMDocumentSchema.parse(docJSON)
  return document
}

export async function resolveHMDocument(
  entityId: UnpackedHypermediaId,
  {discover}: {discover?: boolean} = {},
) {
  try {
    const document = await getHMDocument(entityId, {discover})
    return document
  } catch (e) {
    if (e instanceof HMRedirectError) {
      return await resolveHMDocument(e.target, {discover})
    }
    if (e) throw e
  }
}

const getDirectory = getDiretoryWithClient(queryClient)
const getQueryResults = getQueryResultsWithClient(queryClient)

export async function getBaseDocument(
  entityId: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
  {recursiveDiscover = true}: {recursiveDiscover?: boolean} = {},
): Promise<WebBaseDocumentPayload> {
  const {uid} = entityId
  const path = hmIdPathToEntityQueryPath(entityId.path)
  const discoverPromise = queryClient.entities
    .discoverEntity({
      account: uid,
      path,
      recursive: recursiveDiscover,
      // version ommitted intentionally here. we want to discover the latest version
    })
    .then(() => {})
    .catch((e) => {
      // console.error('error discovering entity', entityId.id, e)
    })
  const latestDocument =
    !!entityId.version && !entityId.latest
      ? await getHMDocument(
          {...entityId, latest: true, version: null},
          {discover: true},
        )
      : null
  const document = await getHMDocument(entityId, {discover: true})
  let authors = await Promise.all(
    document.authors.map(async (authorUid) => {
      return await getMetadata(hmId('d', authorUid))
    }),
  )
  const refs = extractRefs(document.content)
  let supportDocuments: {id: UnpackedHypermediaId; document: HMDocument}[] = (
    await Promise.all(
      refs.map(async (ref) => {
        try {
          const doc = await resolveHMDocument(ref.refId)
          if (!doc) return null
          return {document: doc, id: ref.refId}
        } catch (e) {
          console.error('error fetching supportDocument', ref, e)
        }
      }),
    )
  ).filter((doc) => !!doc)
  let supportQueries: HMQueryResult[] = []

  const queryBlocks = extractQueryBlocks(document.content)
  const homeId = hmId('d', uid)
  const homeDocument = await getHMDocument(homeId)
  supportDocuments.push({
    id: homeId,
    document: homeDocument,
  })
  const homeDirectoryResults = await getDirectory(homeId, 'Children')
  const homeDirectoryQuery = {in: homeId, results: homeDirectoryResults}
  const directoryResults = await getDirectory(entityId)
  const queryBlockQueries = (
    await Promise.all(
      queryBlocks.map(async (block) => {
        return await getQueryResults(block.attributes.query)
      }),
    )
  ).filter((result) => !!result)
  supportQueries = [
    homeDirectoryQuery,
    {in: entityId, results: directoryResults},
    ...queryBlockQueries,
  ]
  const alreadySupportDocIds = new Set<string>()
  supportDocuments.forEach((doc) => {
    if (doc.id.latest || doc.id.version == null) {
      alreadySupportDocIds.add(doc.id.id)
    }
  })
  const supportAuthorsUidsToFetch = new Set<string>()

  supportDocuments.push(
    ...(await Promise.all(
      queryBlockQueries
        .flatMap((item) => item.results)
        .map(async (item) => {
          const id = hmId('d', item.account, {path: item.path})
          const document = await getHMDocument(id)
          document.authors.forEach((author) => {
            if (!alreadySupportDocIds.has(hmId('d', author).id)) {
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
            const document = await getHMDocument(hmId('d', uid), {
              discover: true,
            })
            return {
              id: hmId('d', uid),
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

  return {
    document,
    supportDocuments,
    supportQueries,
    accountsMetadata: Object.fromEntries(
      authors.map((author) => [author.id.uid, author]),
    ),
    isLatest: !latestDocument || latestDocument.version === document.version,
    id: {...entityId, version: document.version},
    ...getOriginRequestData(parsedRequest),
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

export async function getDocument(
  entityId: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
): Promise<WebDocumentPayload> {
  const document = await getBaseDocument(entityId, parsedRequest)
  const crumbs = getParentPaths(entityId.path).slice(0, -1)
  const breadcrumbs = await Promise.all(
    crumbs.map(async (crumbPath) => {
      const id = hmId(entityId.type, entityId.uid, {path: crumbPath})
      const metadataPayload = await getMetadata(id)
      return {
        id,
        metadata: metadataPayload.metadata || {},
      }
    }),
  )
  return {
    ...document,
    breadcrumbs,
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
          const document = await getHMDocument(id)
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
      const document = await getHMDocument(id)
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

function getChildrenType(block: HMBlock): HMBlockChildrenType | undefined {
  if (block.type === 'Paragraph') return block.attributes.childrenType
  if (block.type === 'Heading') return block.attributes.childrenType
  if (block.type === 'Embed') return block.attributes.childrenType
  if (block.type === 'Video') return block.attributes.childrenType
  if (block.type === 'File') return block.attributes.childrenType
  if (block.type === 'Image') return block.attributes.childrenType
  if (block.type === 'Query') return block.attributes.childrenType
  if (block.type === 'Math') return block.attributes.childrenType
  if (block.type === 'Code') return block.attributes.childrenType
  if (block.type === 'Button') return block.attributes.childrenType
  return undefined
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
  return Object.fromEntries(
    await Promise.all(
      authors.map(async (author) => {
        const metadata = await getMetadata(hmId('d', author))
        return [author, metadata]
      }),
    ),
  )
}

export async function loadDocument(
  entityId: UnpackedHypermediaId,
): Promise<HMLoadedDocument> {
  console.log('loadDocument called for:', entityId.id)
  const doc = await getHMDocument(entityId)
  return {
    id: entityId,
    version: doc.version,
    content: await loadDocumentContent(doc.content),
    metadata: doc.metadata,
    authors: await loadAuthors(doc.authors),
  }
}

export type SiteDocumentPayload = WebDocumentPayload & {
  homeMetadata: HMMetadata
  originHomeId: UnpackedHypermediaId
  origin: string
  comment?: HMComment
}

export async function loadSiteDocument<T>(
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
        hmId('d', config.registeredAccountUid),
      )
      homeMetadata = metadata
      originHomeId = id
    } catch (e) {}
  }
  try {
    const docContent = await getDocument(id, parsedRequest)
    let supportQueries = docContent.supportQueries
    if (
      originHomeId &&
      homeMetadata?.layout === 'Seed/Experimental/Newspaper' &&
      !docContent.supportQueries?.find((q) => q.in.uid === originHomeId.uid)
    ) {
      const results = await getDirectory(originHomeId)
      supportQueries = [...(supportQueries || []), {in: originHomeId, results}]
    }
    const loadedSiteDocument = {
      ...(extraData || {}),
      ...docContent,
      homeMetadata,
      supportQueries,
      origin,
      originHomeId,
    }
    const headers: Record<string, string> = {}
    headers['x-hypermedia-id'] = id.id
    headers['x-hypermedia-version'] = docContent.document.version
    return wrapJSON(loadedSiteDocument, {
      headers,
    })
  } catch (e) {
    if (e instanceof HMRedirectError) {
      const destRedirectUrl = createWebHMUrl(e.target.type, e.target.uid, {
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
    // console.error('Error Loading Site Document', id, e)
    // probably document not found. todo, handle other errors
  }
  return wrapJSON(
    {homeMetadata, origin, originHomeId, ...(extraData || {})},
    {status: id ? 200 : 404},
  )
}

export async function loadComment(
  id: UnpackedHypermediaId,
): Promise<HMComment> {
  const c = await queryClient.comments.getComment({
    id: id.uid,
  })
  const comment = c.toJson({emitDefaultValues: true}) as unknown as HMComment
  return comment
}
