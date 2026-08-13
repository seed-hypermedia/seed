import {useInfiniteQuery, useQuery} from '@tanstack/react-query'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {accountMetadataFromAccount} from '../account-metadata'
import {
  ContentTypeFilter,
  DocumentAttributeKind,
  EntityKindFilter,
  DocumentSort,
  ListAccountsRequest,
  ListDocumentAttributeNamesRequest,
  ListDocumentAttributeValuesRequest,
  QueryDocumentsRequest,
} from '../client/grpc-types'
import {
  compileExploreQuery,
  documentInfoToExploreResultDocument,
  searchResultItemToExploreResult,
  type HMExploreContext,
  type HMExploreMatchedField,
  type HMExploreResult,
  type HMExploreResultType,
  type ExploreQueryNode,
  type ParsedExploreQuery,
} from '../explore'
import type {SearchResultItem} from './search'
import {queryKeys} from './query-keys'
import {useUniversalClient} from '../routing'
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

/** Loads spaces and attribute suggestions shared by the Explore builder. */
export function useExploreAccounts(enabled = true) {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.ENTITY, 'explore-accounts'],
    enabled: enabled && Boolean(client.listAccounts),
    queryFn: async () => {
      if (!client.listAccounts) return []
      const response = await client.listAccounts(new ListAccountsRequest({pageSize: 1000}))
      return response.accounts.map((account) => {
        const metadata = accountMetadataFromAccount({
          homeDocumentInfo: account.homeDocumentInfo,
          metadata: account.metadata,
        })
        return {
          value: account.id,
          label: metadata.name || account.id,
          metadata,
        }
      })
    },
  })
}

/** Loads global document attribute names for autocomplete. */
export function useExploreAttributeNames(account = '', enabled = true) {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.ENTITY, 'explore-attribute-names', account],
    enabled: enabled && Boolean(client.listDocumentAttributeNames),
    queryFn: async () => {
      if (!client.listDocumentAttributeNames) return []
      const names: string[] = []
      let pageToken = ''
      do {
        const response = await client.listDocumentAttributeNames(
          new ListDocumentAttributeNamesRequest({account, recursive: true, pageSize: 100, pageToken}),
        )
        names.push(...response.names.map((name) => name.name))
        pageToken = response.nextPageToken
      } while (pageToken)
      return names
    },
  })
}

/** Loads known values for one attribute and scalar kind. */
export function useExploreAttributeValues(path: string, kind: 'string' | 'int' | 'bool', prefix = '', enabled = true) {
  const client = useUniversalClient()
  const attributeKind =
    kind === 'string'
      ? DocumentAttributeKind.STRING
      : kind === 'int'
        ? DocumentAttributeKind.INT
        : DocumentAttributeKind.BOOL
  return useQuery({
    queryKey: [queryKeys.ENTITY, 'explore-attribute-values', path, kind, prefix],
    enabled: enabled && Boolean(path) && Boolean(client.listDocumentAttributeValues) && kind !== 'bool',
    queryFn: async () => {
      if (!client.listDocumentAttributeValues || kind === 'bool') return []
      const response = await client.listDocumentAttributeValues(
        new ListDocumentAttributeValuesRequest({path: path.split('.'), kind: attributeKind, prefix, pageSize: 30}),
      )
      return response.values.flatMap((item) => {
        const value = item.value?.value
        if (!value) return []
        if (value.case === 'stringValue' || value.case === 'intValue' || value.case === 'boolValue')
          return [String(value.value)]
        return []
      })
    },
  })
}

/** Describes which daemon streams are needed for a parsed Explore query. */
export function exploreStreamSelection(parsed: ParsedExploreQuery, context: HMExploreContext) {
  const compilation = compileExploreQuery(parsed, context)
  return {
    text: compilation.textTerms.length > 0,
    documents:
      (compilation.documentPredicates.length > 0 || compilation.requestedTypes.includes('document')) &&
      (Boolean(compilation.filter) || compilation.requestedTypes.includes('document')),
    intersection: compilation.textTerms.length > 0 && compilation.documentPredicates.length > 0 && !!compilation.filter,
  }
}

/** Returns a version-independent identity for a document or its descendants. */
export function exploreDocumentKey(id: {uid: string; path?: string[] | null}) {
  return `${id.uid}:${(id.path ?? []).join('/')}`
}

function resultKey(result: HMExploreResult) {
  if (result.type === 'comment') return `comment:${exploreDocumentKey(result.documentId)}:${result.commentId}`
  if (result.type === 'block') {
    return `block:${exploreDocumentKey(result.id)}:${result.id.blockRef ?? ''}:${result.id.blockRange ?? ''}`
  }
  return `document:${exploreDocumentKey(result.id)}`
}

function parentKey(result: HMExploreResult) {
  if (result.type === 'comment') return exploreDocumentKey(result.documentId)
  if (result.type === 'block') {
    return exploreDocumentKey(result.id)
  }
  return exploreDocumentKey(result.id)
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
  const scopes = compileExploreQuery(parsed, context).positiveScopes
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
  return referencedAttributes(parsed).flatMap((key) => {
    const value = displayValue(metadataValue(document.metadata, key))
    return value ? [{kind: 'attribute' as const, label: key, value, attributePath: key.split('.')}] : []
  })
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
  const selection = exploreStreamSelection(input.parsed, input.context)
  const documentPages = selection.documents ? input.documentPages : undefined
  const textPages = selection.text ? input.textPages : undefined
  const compilation = compileExploreQuery(input.parsed, input.context)
  const documentResults = new Map<string, HMExploreResult>()
  const documentIds = new Set<string>()
  for (const page of documentPages || []) {
    for (const rawDocument of page.documents) {
      const document = rawDocument
      const result = documentInfoToExploreResultDocument(document, matchedFields(document, input.parsed))
      documentResults.set(resultKey(result), result)
      documentIds.add(exploreDocumentKey(document.id))
    }
  }

  const textResults = new Map<string, HMExploreResult>()
  for (const page of textPages || []) {
    for (const entity of page.entities) {
      const result = searchResultItemToExploreResult(entity)
      if (!result) continue
      if (compilation.requestedTypes.length && !compilation.requestedTypes.includes(result.type)) continue
      if (compilation.excludedTypes.includes(result.type)) continue
      // Text hits only survive an intersection once the document side has loaded and contains their parent.
      if (selection.intersection && (input.intersectionPending || !documentIds.has(parentKey(result)))) continue
      textResults.set(resultKey(result), result)
    }
  }

  const combined = new Map<string, HMExploreResult>()
  const intersection = selection.intersection
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
    (result) =>
      (compilation.requestedTypes.length === 0 || compilation.requestedTypes.includes(result.type)) &&
      !compilation.excludedTypes.includes(result.type),
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
    diagnostics: input.parsed.diagnostics.concat(compilation.diagnostics),
    intersectionTruncated: input.intersectionTruncated ?? false,
    intersectionPending: input.intersectionPending ?? (selection.intersection && !documentPages),
    blocksByDocument,
  }
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
  const typeOnlyQuery = compilation.requestedTypes.includes('document') && !hasDocuments && !hasText
  const shouldFetchDocuments = enabled && (hasDocuments || typeOnlyQuery) && Boolean(client.queryDocuments)
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
    queryKey: [queryKeys.ENTITY, 'explore-text', parsed.ast, context, compilation.requestedTypes],
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

  const selection = exploreStreamSelection(parsed, context)
  const documentPages = selection.documents ? documentQuery.data?.pages : undefined
  const textPages = selection.text ? textQuery.data?.pages : undefined
  const assembly = assembleExploreResults({
    parsed,
    context,
    documentPages,
    textPages,
    intersectionTruncated: Boolean(documentPages?.some((page) => page.truncatedByCap)),
    intersectionPending: selection.intersection && !documentPages,
  })
  const loadMore = async () => {
    await Promise.all([
      selection.documents && documentQuery.hasNextPage ? documentQuery.fetchNextPage() : undefined,
      selection.text && textQuery.hasNextPage ? textQuery.fetchNextPage() : undefined,
    ])
  }
  return {
    ...assembly,
    documentStream: {
      isLoading: selection.documents && documentQuery.isLoading,
      error: selection.documents ? documentQuery.error : null,
      hasMore: selection.documents && Boolean(documentQuery.hasNextPage),
    },
    textStream: {
      isLoading: selection.text && textQuery.isLoading,
      error: selection.text ? textQuery.error : null,
      hasMore: selection.text && Boolean(textQuery.hasNextPage),
    },
    isLoading: (selection.documents && documentQuery.isLoading) || (selection.text && textQuery.isLoading) || false,
    isRefetching:
      (selection.documents && documentQuery.isFetching && !documentQuery.isLoading) ||
      (selection.text && textQuery.isFetching && !textQuery.isLoading) ||
      false,
    error: (selection.documents ? documentQuery.error : null) || (selection.text ? textQuery.error : null) || null,
    loadMore,
    hasMore: Boolean((selection.documents && documentQuery.hasNextPage) || (selection.text && textQuery.hasNextPage)),
  }
}
