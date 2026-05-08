import {Query, QueryCache, QueryClient, type QueryKey} from '@tanstack/react-query'
import type {CachedAccount} from '@seed-hypermedia/client/hm-types'
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
 * Write `data` into `[ACCOUNT, uid]`, but only if it differs from what's
 * already there. Equality is determined by `version` (the home document
 * version CID) — when both versions are non-null and equal, the cache write
 * is skipped to avoid spurious re-renders for unchanged data.
 *
 * Returns `true` when the cache was written, `false` when skipped.
 */
export function populateAccountIfChanged(client: QueryClient, uid: string, data: CachedAccount): boolean {
  const queryKey = [queryKeys.ACCOUNT, uid] as const
  const existing = client.getQueryData<CachedAccount>(queryKey)
  if (existing && existing.version && data.version && existing.version === data.version) {
    return false
  }
  client.setQueryData(queryKey, data)
  return true
}
