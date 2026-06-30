import {Query, QueryCache, QueryClient, type QueryKey} from '@tanstack/react-query'

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

/** Update cached data for all queries matching a key prefix. */
export function updateQueriesDataByKey(queryKey: QueryKey, updater: (data: unknown) => unknown) {
  if (registeredClient) {
    registeredClient.setQueriesData({queryKey}, updater)
  }
}

/**
 * Force an immediate background refetch of all queries matching a key prefix.
 * Use after mutations when `invalidateQueries` alone doesn't trigger the
 * desired refetch (e.g. when callers depend on the freshest server state).
 */
export function refetchQueriesByKey(queryKey: QueryKey): Promise<void> {
  if (registeredClient) {
    return registeredClient.refetchQueries({queryKey}) as Promise<void>
  }
  return Promise.resolve()
}
