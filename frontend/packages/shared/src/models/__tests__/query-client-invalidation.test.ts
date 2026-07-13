import {QueryClient} from '@tanstack/react-query'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {invalidateQueries, registerQueryClient} from '../query-client'

/**
 * Regression test for #812: on web the query client disables `refetchOnMount`,
 * so a query that is inactive when invalidated (e.g. the discussions list after
 * posting a comment navigates to the focused-comment view) would keep rendering
 * its stale cache forever when remounted. `refetchType: 'all'` makes the
 * invalidation refetch inactive queries immediately.
 */
describe('invalidateQueries refetchType', () => {
  // Mirror the web browser query client defaults (apps/web/app/providers.tsx)
  function createWebLikeQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
          retry: false,
        },
      },
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setupInactiveQuery(client: QueryClient) {
    registerQueryClient(client)
    const queryFn = vi.fn(async () => ({comments: ['old']}))
    const key = ['DOCUMENT_DISCUSSION', {uid: 'doc1'}]
    // Fetch once, then leave the query with no observers (inactive), like an
    // unmounted discussions list.
    await client.fetchQuery({queryKey: key, queryFn})
    expect(queryFn).toHaveBeenCalledTimes(1)
    queryFn.mockResolvedValue({comments: ['old', 'new']})
    return {queryFn, key}
  }

  it("default invalidation does not refetch inactive queries (why 'all' is needed)", async () => {
    const client = createWebLikeQueryClient()
    const {queryFn, key} = await setupInactiveQuery(client)

    invalidateQueries(['DOCUMENT_DISCUSSION'])
    await vi.waitFor(() => expect(client.isFetching()).toBe(0))

    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(key)).toEqual({comments: ['old']})
  })

  it("refetchType 'all' refetches inactive queries so remounts see fresh data", async () => {
    const client = createWebLikeQueryClient()
    const {queryFn, key} = await setupInactiveQuery(client)

    invalidateQueries(['DOCUMENT_DISCUSSION'], {refetchType: 'all'})
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual({comments: ['old', 'new']}))
  })
})
