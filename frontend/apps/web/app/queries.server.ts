/**
 * Server-side query utilities for SSR hydration.
 *
 * These utilities prefetch data into a QueryClient for dehydration.
 * The prefetched data is then hydrated on the client.
 */

import {
  HMDocument,
  HMMetadata,
  HMMetadataPayload,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {dehydrate, QueryClient} from '@tanstack/react-query'
import {webQueryKeys} from './queries'

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

// Prefetch utilities - these set data directly (no fetch needed since loader already has data)

export function prefetchHomeDocument(
  ctx: PrefetchContext,
  uid: string,
  document: HMDocument,
) {
  ctx.queryClient.setQueryData(webQueryKeys.homeDocument(uid), document)
}

export function prefetchSupportDocument(
  ctx: PrefetchContext,
  id: UnpackedHypermediaId,
  document: HMDocument,
) {
  ctx.queryClient.setQueryData(webQueryKeys.supportDocument(id), document)
}

export function prefetchHomeDirectory(
  ctx: PrefetchContext,
  uid: string,
  results: HMQueryResult['results'],
) {
  ctx.queryClient.setQueryData(webQueryKeys.homeDirectory(uid), results)
}

export function prefetchDocDirectory(
  ctx: PrefetchContext,
  id: UnpackedHypermediaId,
  results: HMQueryResult['results'],
) {
  ctx.queryClient.setQueryData(webQueryKeys.docDirectory(id), results)
}

export function prefetchAccountMetadata(
  ctx: PrefetchContext,
  uid: string,
  metadata: HMMetadata | null,
) {
  if (metadata) {
    ctx.queryClient.setQueryData(webQueryKeys.accountMetadata(uid), metadata)
  }
}

/**
 * Prefetch all support documents from a list.
 */
export function prefetchSupportDocuments(
  ctx: PrefetchContext,
  supportDocuments: Array<{id: UnpackedHypermediaId; document: HMDocument}>,
) {
  for (const {id, document} of supportDocuments) {
    prefetchSupportDocument(ctx, id, document)
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
    prefetchAccountMetadata(ctx, author.id.uid, author.metadata)
  }
}
