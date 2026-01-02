/**
 * Server-side query utilities for SSR hydration.
 *
 * Creates per-request QueryClient instances and handles dehydration
 * for transfer to the client. Prefetching is done directly in loaders
 * using shared query objects from @shm/shared.
 */

import { dehydrate, QueryClient } from "@tanstack/react-query";

export type PrefetchContext = {
  queryClient: QueryClient;
};

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
  };
}

/**
 * Dehydrate the QueryClient state for transfer to the client.
 */
export function dehydratePrefetchContext(ctx: PrefetchContext) {
  return dehydrate(ctx.queryClient);
}
