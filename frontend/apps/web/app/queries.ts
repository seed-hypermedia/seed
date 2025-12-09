/**
 * Shared query definitions for SSR hydration pattern.
 *
 * These query options are used by both:
 * - Server loader: queryClient.prefetchQuery(queryOptions)
 * - Client components: useQuery(queryOptions)
 *
 * The queryFn is only called server-side during prefetch.
 * On the client, data comes from hydration so queryFn is never called
 * (unless cache is invalidated).
 */

import {
  HMDocument,
  HMMetadata,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {queryOptions, useQuery} from '@tanstack/react-query'

// Query key factories - these generate consistent keys for the same data
export const webQueryKeys = {
  // Home document for a site (the root document at path=[])
  homeDocument: (uid: string) => [queryKeys.ENTITY, 'home', uid] as const,

  // Support documents (embedded/referenced docs)
  supportDocument: (id: UnpackedHypermediaId) =>
    [queryKeys.ENTITY, 'support', id.uid, id.path, id.version] as const,

  // Directory listing for home
  homeDirectory: (uid: string) =>
    [queryKeys.DOC_LIST_DIRECTORY, 'home', uid] as const,

  // Directory listing for a specific doc
  docDirectory: (id: UnpackedHypermediaId) =>
    [queryKeys.DOC_LIST_DIRECTORY, 'doc', id.uid, id.path] as const,

  // Account metadata
  accountMetadata: (uid: string) => [queryKeys.ACCOUNT, uid] as const,
}

// Query options factories - these create full query options including queryFn
// Note: queryFn throws on client since data should come from hydration

export function homeDocumentQueryOptions(uid: string) {
  return queryOptions<HMDocument | null>({
    queryKey: webQueryKeys.homeDocument(uid),
    queryFn: () => {
      throw new Error(
        'homeDocumentQueryOptions queryFn should not be called on client - data comes from SSR hydration',
      )
    },
    staleTime: Infinity,
  })
}

export function supportDocumentQueryOptions(id: UnpackedHypermediaId) {
  return queryOptions<HMDocument | null>({
    queryKey: webQueryKeys.supportDocument(id),
    queryFn: () => {
      throw new Error(
        'supportDocumentQueryOptions queryFn should not be called on client - data comes from SSR hydration',
      )
    },
    staleTime: Infinity,
  })
}

export function homeDirectoryQueryOptions(uid: string) {
  return queryOptions<HMQueryResult['results'] | null>({
    queryKey: webQueryKeys.homeDirectory(uid),
    queryFn: () => {
      throw new Error(
        'homeDirectoryQueryOptions queryFn should not be called on client - data comes from SSR hydration',
      )
    },
    staleTime: Infinity,
  })
}

export function docDirectoryQueryOptions(id: UnpackedHypermediaId) {
  return queryOptions<HMQueryResult['results'] | null>({
    queryKey: webQueryKeys.docDirectory(id),
    queryFn: () => {
      throw new Error(
        'docDirectoryQueryOptions queryFn should not be called on client - data comes from SSR hydration',
      )
    },
    staleTime: Infinity,
  })
}

export function accountMetadataQueryOptions(uid: string) {
  return queryOptions<HMMetadata | null>({
    queryKey: webQueryKeys.accountMetadata(uid),
    queryFn: () => {
      throw new Error(
        'accountMetadataQueryOptions queryFn should not be called on client - data comes from SSR hydration',
      )
    },
    staleTime: Infinity,
  })
}

// Client-side hooks that use the hydrated query data

export function useHomeDocument(uid: string) {
  return useQuery(homeDocumentQueryOptions(uid))
}

export function useSupportDocument(id: UnpackedHypermediaId) {
  return useQuery(supportDocumentQueryOptions(id))
}

export function useHomeDirectory(uid: string) {
  return useQuery(homeDirectoryQueryOptions(uid))
}

export function useDocDirectory(id: UnpackedHypermediaId) {
  return useQuery(docDirectoryQueryOptions(id))
}

export function useAccountMetadata(uid: string) {
  return useQuery(accountMetadataQueryOptions(uid))
}
