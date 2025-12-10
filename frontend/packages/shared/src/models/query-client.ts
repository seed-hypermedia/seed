import {Query, QueryCache, QueryClient, QueryKey} from '@tanstack/react-query'

// Re-export for consumers to avoid duplicate package instances
export {QueryClientProvider, useQueryClient} from '@tanstack/react-query'

const queryCacheErrorSubscriptions = new Set<
  (error: unknown, query: Query) => void
>()

export function onQueryCacheError(
  handler: (error: unknown, query: Query) => void,
) {
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
      retryDelay: (attempt) =>
        Math.min(attempt > 1 ? 2 ** attempt * 1000 : 1000, 30 * 1000),
      keepPreviousData: true,
    },
  },
})

const queryInvalidationSubscriptions = new Set<(queryKey: QueryKey) => void>()

export function onQueryInvalidation(handler: (queryKey: QueryKey) => void) {
  queryInvalidationSubscriptions.add(handler)
}

export function invalidateQueries(queryKey: QueryKey) {
  queryInvalidationSubscriptions.forEach((handler) => handler(queryKey))
}
