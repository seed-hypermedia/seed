/**
 * The one provider the shared Agents stack needs mounted, plus platform registration.
 *
 * `@shm/ui/agents/models` is built on React Query, and its mutations call the shared
 * `invalidateQueries` helper rather than reaching for a client through context — so the client has
 * to be *registered* as well as provided, exactly as web and desktop do it. Without the
 * registration, mutations succeed and the lists that should reflect them never refetch.
 */

// `QueryClientProvider` comes straight from react-query rather than through @shm/shared's
// re-export: TypeScript resolves a re-exported symbol's dependencies from the *re-exporting*
// package, so the shared copy is typed against the monorepo root's React 18 while this app is on
// React 19, and the two `ReactNode`s are not assignable. Metro pins one runtime copy of
// react-query (see metro.config.js), so this is a types-only distinction — `queryClient` below is
// still the shared singleton that `invalidateQueries` writes through.
import {QueryClientProvider} from '@tanstack/react-query'
import {queryClient, registerQueryClient} from '@shm/shared/models/query-client'
import type {ReactNode} from 'react'
import {registerMobileAgentsPlatform} from './platform'

// Both are process-wide and idempotent, so they run at import time — before any agents UI renders,
// which is what the platform seam requires.
registerMobileAgentsPlatform()
registerQueryClient(queryClient)

/** Wraps the app so the shared agents hooks have their React Query client. */
export function AgentsProvider({children}: {children: ReactNode}) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
