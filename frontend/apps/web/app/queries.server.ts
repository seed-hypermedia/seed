/**
 * Server-side query utilities for SSR hydration.
 *
 * These utilities prefetch data into a QueryClient for dehydration.
 * The prefetched data is then hydrated on the client using the same
 * query keys as the shared models (useResource, useDirectory, etc.).
 */

import {
  HMDocument,
  HMDocumentInfo,
  HMMetadata,
  HMMetadataPayload,
  HMResource,
  hmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {dehydrate, QueryClient} from '@tanstack/react-query'

export type PrefetchContext = {
  queryClient: QueryClient
}

/**
 * Create a new prefetch context for a request.
 * Each request should have its own QueryClient to avoid shared state.
 */
export function createPrefetchContext(): PrefetchContext {
  return {
    queryClient: new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          retry: false,
        },
      },
    }),
  }
}

/**
 * Dehydrate the QueryClient state for transfer to the client.
 */
export function dehydratePrefetchContext(ctx: PrefetchContext) {
  return dehydrate(ctx.queryClient)
}

// Prefetch utilities - use the same query keys as shared models

/**
 * Prefetch a resource (document, comment, etc.)
 * Uses same key as useResource: [queryKeys.ENTITY, id.id, version]
 */
export function prefetchResource(
  ctx: PrefetchContext,
  id: UnpackedHypermediaId,
  resource: HMResource,
) {
  const version = id.version || undefined
  ctx.queryClient.setQueryData([queryKeys.ENTITY, id.id, version], resource)
}

/**
 * Prefetch a document as a resource.
 * Wraps the document in HMResource format.
 */
export function prefetchDocument(
  ctx: PrefetchContext,
  id: UnpackedHypermediaId,
  document: HMDocument,
) {
  const resource: HMResource = {
    type: 'document',
    id,
    document,
  }
  prefetchResource(ctx, id, resource)
}

/**
 * Prefetch directory listing.
 * Uses same key as useDirectory: [queryKeys.DOC_LIST_DIRECTORY, id.id, mode]
 */
export function prefetchDirectory(
  ctx: PrefetchContext,
  id: UnpackedHypermediaId,
  results: HMDocumentInfo[],
  mode: 'Children' | 'AllDescendants' = 'Children',
) {
  ctx.queryClient.setQueryData(
    [queryKeys.DOC_LIST_DIRECTORY, id.id, mode],
    results,
  )
}

/**
 * Prefetch account metadata.
 * Uses same key as useAccount: [queryKeys.ACCOUNT, uid]
 */
export function prefetchAccount(
  ctx: PrefetchContext,
  uid: string,
  metadata: HMMetadata | null,
) {
  if (metadata) {
    const payload: HMMetadataPayload = {
      id: hmId(uid),
      metadata,
    }
    ctx.queryClient.setQueryData([queryKeys.ACCOUNT, uid], payload)
  }
}

/**
 * Prefetch all embedded documents from a list.
 */
export function prefetchEmbeddedDocuments(
  ctx: PrefetchContext,
  embeddedDocs: Array<{id: UnpackedHypermediaId; document: HMDocument}>,
) {
  for (const {id, document} of embeddedDocs) {
    prefetchDocument(ctx, id, document)
  }
}

/**
 * Prefetch account metadata from author list.
 */
export function prefetchAuthorsMetadata(
  ctx: PrefetchContext,
  authors: Array<HMMetadataPayload>,
) {
  for (const author of authors) {
    prefetchAccount(ctx, author.id.uid, author.metadata)
  }
}
