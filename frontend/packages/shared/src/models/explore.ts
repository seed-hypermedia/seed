import {useInfiniteQuery} from '@tanstack/react-query'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {ContentTypeFilter, EntityKindFilter, DocumentSort, QueryDocumentsRequest} from '../client/grpc-types'
import {
  compileExploreQuery,
  documentInfoToExploreResultDocument,
  searchResultItemToExploreResult,
  type HMExploreContext,
  type HMExploreMatchedField,
  type HMExploreResult,
  type HMExploreResultType,
  type ExplorePredicate,
  type ExploreQueryNode,
  type ParsedExploreQuery,
} from '../explore'
import type {SearchResultItem} from './search'
import {queryKeys} from './query-keys'
import {useUniversalClient} from '../routing'
import {packHmId} from '../utils/entity-id-url'
import {prepareHMDocumentInfo} from './entity'

/** A page returned by the document stream. */
export type ExploreDocumentPage = {
  documents: HMDocumentInfo[]
  nextPageToken: string
  truncatedByCap?: boolean
}

/** A page returned by the text stream. */
export type ExploreTextPage = {
  entities: SearchResultItem[]
  nextPageToken: string
}

/** Results assembled from the document and text streams. */
export type ExploreAssembly = {
  results: HMExploreResult[]
  documents: HMExploreResult[]
  blocks: HMExploreResult[]
  comments: HMExploreResult[]
  counts: Record<HMExploreResultType | 'all', number>
  textTerms: string[]
  diagnostics: ParsedExploreQuery['diagnostics']
  intersectionTruncated: boolean
  intersectionPending: boolean
  blocksByDocument: Record<string, Extract<HMExploreResult, {type: 'block'}>[]>
}

export const EXPLORE_INTERSECTION_DOCUMENT_CAP = 1000

/** Describes which daemon streams are needed for a parsed Explore query. */
export function exploreStreamSelection(parsed: ParsedExploreQuery, context: HMExploreContext) {
  const compilation = compileExploreQuery(parsed, context)
  return {
    text: compilation.textTerms.length > 0,
    documents: compilation.documentPredicates.length > 0,
    intersection: compilation.textTerms.length > 0 && compilation.documentPredicates.length > 0,
  }
}

function resultKey(result: HMExploreResult) {
  if (result.type === 'comment') return `comment:${packHmId(result.documentId)}:${result.commentId}`
  return `${result.type}:${packHmId(result.id)}`
}

function parentKey(result: HMExploreResult) {
  if (result.type === 'comment') return packHmId(result.documentId)
  if (result.type === 'block') {
    const {blockRef: _blockRef, blockRange: _blockRange, ...baseId} = result.id
    const documentId = {...baseId, blockRef: null, blockRange: null}
    return packHmId(documentId)
  }
  return packHmId(result.id)
}

function referencedAttributes(parsed: ParsedExploreQuery) {
  const keys: string[] = []
  const visit = (node: ExploreQueryNode | null) => {
    if (!node) return
    if (node.kind === 'predicate' && node.predicate.kind === 'attribute' && !keys.includes(node.predicate.key))
      keys.push(node.predicate.key)
    if (node.kind === 'and' || node.kind === 'or') node.children.forEach(visit)
    if (node.kind === 'not') visit(node.child)
  }
  visit(parsed.ast)
  return keys
}

function metadataValue(metadata: unknown, path: string): unknown {
  let current: unknown = metadata
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function displayValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function searchIriFilter(context: HMExploreContext, parsed: ParsedExploreQuery) {
  const scopes = compileExploreQuery(parsed, context).documentPredicates.filter(
    (predicate): predicate is Extract<ExplorePredicate, {kind: 'scope'}> => predicate.kind === 'scope',
  )
  // Search accepts one iriFilter; widening is required for OR scopes such as in:alice OR in:bob.
  if (scopes.length > 1) return undefined
  const scope = scopes[0]
  if (scope?.kind === 'scope') {
    if (scope.scope === 'url') return `${scope.value}${scope.value.endsWith('*') ? '' : '*'}`
    if (scope.scope === 'space') return `hm://${scope.value}*`
    if (scope.scope === 'path') {
      const pathScope = scope as Extract<typeof scope, {scope: 'path'}>
      return context.type === 'site'
        ? `hm://${context.id.uid}/${pathScope.value.replace(/^\/+/, '')}${pathScope.prefix ? '*' : ''}`
        : undefined
    }
  }
  return context.type === 'site'
    ? `hm://${context.id.uid}${context.id.path?.length ? `/${context.id.path.join('/')}*` : '*'}`
    : undefined
}

function matchedFields(document: HMDocumentInfo, parsed: ParsedExploreQuery): HMExploreMatchedField[] {
  return referencedAttributes(parsed).map((key) => ({
    kind: 'attribute' as const,
    label: key,
    value: displayValue(metadataValue(document.metadata, key)),
    attributePath: key.split('.'),
  }))
}

/** Assembles fake or fetched stream pages into stable Explore results. */
export function assembleExploreResults(input: {
  parsed: ParsedExploreQuery
  context: HMExploreContext
  documentPages?: ExploreDocumentPage[]
  textPages?: ExploreTextPage[]
  intersectionTruncated?: boolean
  intersectionPending?: boolean
}): ExploreAssembly {
  const compilation = compileExploreQuery(input.parsed, input.context)
  const documentResults = new Map<string, HMExploreResult>()
  const documentIds = new Set<string>()
  for (const page of input.documentPages || []) {
    for (const rawDocument of page.documents) {
      const document = rawDocument
      const result = documentInfoToExploreResultDocument(document, matchedFields(document, input.parsed))
      documentResults.set(resultKey(result), result)
      documentIds.add(packHmId(document.id))
    }
  }

  const textResults = new Map<string, HMExploreResult>()
  for (const page of input.textPages || []) {
    for (const entity of page.entities) {
      const result = searchResultItemToExploreResult(entity)
      if (!result) continue
      if (compilation.requestedTypes.length && !compilation.requestedTypes.includes(result.type)) continue
      if (input.intersectionPending || (documentPagesActive(input) && !documentIds.has(parentKey(result)))) continue
      textResults.set(resultKey(result), result)
    }
  }

  const combined = new Map<string, HMExploreResult>()
  const intersection = compilation.textTerms.length > 0 && compilation.documentPredicates.length > 0
  if (!intersection) {
    for (const result of Array.from(documentResults.values())) combined.set(resultKey(result), result)
  }
  for (const result of Array.from(textResults.values())) {
    const key = resultKey(result)
    const document = documentResults.get(key)
    if (document && result.type === 'document') {
      combined.set(key, {
        ...document,
        matchText: result.matchText,
        matchedFields: document.matchedFields,
      })
    } else {
      combined.set(key, result)
    }
  }

  const results = Array.from(combined.values()).filter(
    (result) => !compilation.requestedTypes.length || compilation.requestedTypes.includes(result.type),
  )
  const documents = results.filter((result) => result.type === 'document')
  const blocks = results.filter((result) => result.type === 'block')
  const comments = results.filter((result) => result.type === 'comment')
  const blocksByDocument: ExploreAssembly['blocksByDocument'] = {}
  for (const block of blocks) {
    if (block.type !== 'block') continue
    const key = parentKey(block)
    ;(blocksByDocument[key] ||= []).push(block)
  }
  return {
    results,
    documents,
    blocks,
    comments,
    counts: {all: results.length, document: documents.length, block: blocks.length, comment: comments.length},
    textTerms: compilation.textTerms.map((term) => (term.phrase ? `"${term.value}"` : term.value)),
    diagnostics: input.parsed.diagnostics,
    intersectionTruncated: input.intersectionTruncated ?? false,
    intersectionPending: input.intersectionPending ?? false,
    blocksByDocument,
  }
}

function documentPagesActive(input: {documentPages?: ExploreDocumentPage[]}) {
  return Boolean(input.documentPages)
}

function textPageFromResponse(response: {entities: SearchResultItem[]; nextPageToken?: string}): ExploreTextPage {
  return {entities: response.entities, nextPageToken: response.nextPageToken || ''}
}

function contentTypeFilters(types: HMExploreResultType[]) {
  if (types.length === 1 && types[0] === 'comment') return [ContentTypeFilter.CONTENT_TYPE_COMMENT]
  if (types.length === 1 && types[0] === 'block') return [ContentTypeFilter.CONTENT_TYPE_DOCUMENT]
  return [
    ContentTypeFilter.CONTENT_TYPE_TITLE,
    ContentTypeFilter.CONTENT_TYPE_DOCUMENT,
    ContentTypeFilter.CONTENT_TYPE_COMMENT,
  ]
}

function entityKindFilters(types: HMExploreResultType[]) {
  if (types.length === 1 && types[0] === 'comment') return [EntityKindFilter.ENTITY_KIND_COMMENT]
  if (types.length === 1 && types[0] === 'block') return [EntityKindFilter.ENTITY_KIND_DOCUMENT]
  return [
    EntityKindFilter.ENTITY_KIND_SPACE,
    EntityKindFilter.ENTITY_KIND_DOCUMENT,
    EntityKindFilter.ENTITY_KIND_COMMENT,
  ]
}

/** Shared TanStack Query hook for desktop and web Explore views. */
export function useExploreResults(
  parsed: ParsedExploreQuery,
  context: HMExploreContext,
  options: {enabled?: boolean; pageSize?: number} = {},
) {
  const client = useUniversalClient()
  const compilation = compileExploreQuery(parsed, context)
  const enabled = options.enabled ?? true
  const pageSize = options.pageSize ?? 50
  const hasText = compilation.textTerms.length > 0
  const hasDocuments = compilation.documentPredicates.length > 0
  const shouldFetchDocuments = enabled && hasDocuments && Boolean(client.queryDocuments)
  const shouldFetchText = enabled && hasText

  const documentQuery = useInfiniteQuery({
    queryKey: [queryKeys.ENTITY, 'explore-documents', parsed.ast, context, parsed.presentation],
    enabled: shouldFetchDocuments,
    queryFn: async ({pageParam = '', signal}: {pageParam?: string; signal?: AbortSignal}) => {
      if (!client.queryDocuments) throw new Error('QueryDocuments is unavailable on this platform.')
      const documents: HMDocumentInfo[] = []
      let nextPageToken = pageParam
      do {
        const response = await client.queryDocuments(
          new QueryDocumentsRequest({
            filter: compilation.filter,
            pageSize,
            pageToken: nextPageToken,
            sort: (parsed.presentation.sort || []).map(
              (rule) => new DocumentSort({key: rule.key, descending: rule.direction === 'desc'}),
            ),
          }),
          {signal},
        )
        documents.push(...response.documents.map((document) => prepareHMDocumentInfo(document)))
        nextPageToken = response.nextPageToken
        if (!hasText || documents.length >= EXPLORE_INTERSECTION_DOCUMENT_CAP || !nextPageToken) break
      } while (nextPageToken)
      const truncatedByCap = hasText && documents.length >= EXPLORE_INTERSECTION_DOCUMENT_CAP && Boolean(nextPageToken)
      return {
        documents: documents.slice(0, hasText ? EXPLORE_INTERSECTION_DOCUMENT_CAP : undefined),
        nextPageToken: truncatedByCap ? '' : nextPageToken,
        truncatedByCap,
      }
    },
    getNextPageParam: (page) => page.nextPageToken || undefined,
  })

  const textQuery = useInfiniteQuery({
    queryKey: [queryKeys.ENTITY, 'explore-text', compilation.textTerms, context, compilation.requestedTypes],
    enabled: shouldFetchText,
    queryFn: async ({pageParam = '', signal}: {pageParam?: string; signal?: AbortSignal}) => {
      const response = await client.request(
        'Search',
        {
          query: compilation.textTerms.map((term) => (term.phrase ? `"${term.value}"` : term.value)).join(' '),
          includeBody: true,
          contextSize: 96,
          pageSize,
          pageToken: pageParam,
          iriFilter: searchIriFilter(context, parsed),
          contentTypeFilter: contentTypeFilters(compilation.requestedTypes),
          entityKindFilter: entityKindFilters(compilation.requestedTypes),
        },
        {signal},
      )
      return textPageFromResponse(response)
    },
    getNextPageParam: (page) => page.nextPageToken || undefined,
  })

  const documentPages = documentQuery.data?.pages
  const textPages = textQuery.data?.pages
  const assembly = assembleExploreResults({
    parsed,
    context,
    documentPages,
    textPages,
    intersectionTruncated: Boolean(documentPages?.some((page) => page.truncatedByCap)),
    intersectionPending: hasText && hasDocuments && !documentPages,
  })
  const loadMore = async () => {
    await Promise.all([
      documentQuery.hasNextPage ? documentQuery.fetchNextPage() : undefined,
      textQuery.hasNextPage ? textQuery.fetchNextPage() : undefined,
    ])
  }
  return {
    ...assembly,
    documentStream: {
      isLoading: documentQuery.isLoading,
      error: documentQuery.error,
      hasMore: Boolean(documentQuery.hasNextPage),
    },
    textStream: {
      isLoading: textQuery.isLoading,
      error: textQuery.error,
      hasMore: Boolean(textQuery.hasNextPage),
    },
    isLoading: documentQuery.isLoading || textQuery.isLoading,
    error: documentQuery.error || textQuery.error || null,
    loadMore,
    hasMore: Boolean(documentQuery.hasNextPage || textQuery.hasNextPage),
  }
}
