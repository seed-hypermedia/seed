import {Query, QueryCache, QueryClient, type QueryKey} from '@tanstack/react-query'
import type {HMMetadataPayload} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from './query-keys'

// Re-export for consumers to avoid duplicate package instances
export {QueryClientProvider, useQueryClient} from '@tanstack/react-query'

const queryCacheErrorSubscriptions = new Set<(error: unknown, query: Query) => void>()

export function onQueryCacheError(handler: (error: unknown, query: Query) => void) {
  queryCacheErrorSubscriptions.add(handler)
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      queryCacheErrorSubscriptions.forEach((handler) => handler(err, query))
    },
  }),
  defaultOptions: {
    mutations: {
      networkMode: 'always',
    },
    queries: {
      networkMode: 'always',
      useErrorBoundary: true,
      retryOnMount: false,
      staleTime: Infinity,
      refetchOnReconnect: false,
      onError: (err) => {
        console.log(`Query error: ${JSON.stringify(err)}`)
      },
      retry: 4,
      retryDelay: (attempt) => Math.min(attempt > 1 ? 2 ** attempt * 1000 : 1000, 30 * 1000),
      keepPreviousData: true,
    },
  },
})

const queryInvalidationSubscriptions = new Set<(queryKey: QueryKey) => void>()

export function onQueryInvalidation(handler: (queryKey: QueryKey) => void) {
  queryInvalidationSubscriptions.add(handler)
}

let registeredClient: QueryClient | null = null

export function registerQueryClient(client: QueryClient) {
  registeredClient = client
}

export function invalidateQueries(queryKey: QueryKey) {
  // Always invalidate the registered client directly
  if (registeredClient) {
    registeredClient.invalidateQueries({queryKey})
  }
  // Fire subscriptions for platform-specific behavior (IPC broadcast on desktop)
  queryInvalidationSubscriptions.forEach((handler) => handler(queryKey))
}

/**
 * Immediately set cached data for all queries matching a key prefix.
 * Use after mutations to prevent stale-while-revalidate flashes.
 */
export function setQueriesDataByKey(queryKey: QueryKey, data: unknown) {
  if (registeredClient) {
    registeredClient.setQueriesData({queryKey}, data)
  }
}

/**
 * Write `data` into `[ACCOUNT, uid]` only when its `version` differs from
 * the cached entry's version. Skipping no-op writes avoids spurious
 * re-renders when comment queries refetch and re-emit the same author
 * metadata. Returns true when the cache was written, false when skipped.
 */
export function populateAccountIfChanged(client: QueryClient, uid: string, data: HMMetadataPayload): boolean {
  const queryKey = [queryKeys.ACCOUNT, uid] as const
  const existing = client.getQueryData<HMMetadataPayload>(queryKey)
  if (existing?.version && data.version && existing.version === data.version) {
    return false
  }
  client.setQueryData(queryKey, data)
  return true
}

/**
 * Invalidate `[ACCOUNT, uid]` plus every cached account whose `profileOwner`
 * matches `uid` — i.e. accounts that alias to `uid` and therefore display
 * its profile metadata. The cache itself is the source of truth: each entry
 * carries its resolved `profileOwner`, so a single scan finds the closure.
 *
 * Each match routes through `invalidateQueries` so platform subscriptions
 * (desktop IPC broadcast) fire normally for every invalidated key.
 */
export function invalidateAccountAndAliases(uid: string) {
  if (!registeredClient) {
    invalidateQueries([queryKeys.ACCOUNT, uid])
    return
  }
  const queries = registeredClient.getQueryCache().findAll({queryKey: [queryKeys.ACCOUNT]})
  const toInvalidate = new Set<string>([uid])
  queries.forEach((q) => {
    const data = q.state.data as {profileOwner?: string} | null | undefined
    const cacheKeyUid = q.queryKey[1]
    if (data?.profileOwner === uid && typeof cacheKeyUid === 'string') {
      toInvalidate.add(cacheKeyUid)
    }
  })
  toInvalidate.forEach((aliasUid) => invalidateQueries([queryKeys.ACCOUNT, aliasUid]))
}
