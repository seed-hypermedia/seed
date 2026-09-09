import {QueryClient} from '@tanstack/react-query'
import {registerQueryClient} from '@shm/shared/models/query-client'
import {afterEach, describe, expect, test, vi} from 'vitest'
import {invalidateForAccountChange} from '../agents/models'

const serverUrl = 'https://agents.example'
const accountUid = 'z6MkViewer'
const agentId = 'agent-1'

// The web app's query client: nothing refetches on mount, so an invalidation that only refetches
// active queries leaves a cached-but-unmounted list stale until a full reload.
function webQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {staleTime: 30_000, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false},
    },
  })
  registerQueryClient(client)
  return client
}

async function seedInactiveQuery(client: QueryClient, queryKey: unknown[]) {
  const queryFn = vi.fn(async () => ({fetchedAt: Date.now()}))
  // fetchQuery populates the cache without an observer: the same state as a page the user left.
  await client.fetchQuery({queryKey, queryFn})
  expect(queryFn).toHaveBeenCalledTimes(1)
  return queryFn
}

afterEach(() => {
  registerQueryClient(new QueryClient())
})

describe('invalidateForAccountChange', () => {
  test('a session the runtime created refetches the agent page and session lists even while unmounted', async () => {
    const client = webQueryClient()
    const detail = await seedInactiveQuery(client, ['agents', 'detail', serverUrl, accountUid, agentId])
    const list = await seedInactiveQuery(client, ['agents', 'sessions', serverUrl, accountUid])

    invalidateForAccountChange(serverUrl, accountUid, {reason: 'session-created', agentId, sessionId: 'successor'})

    await vi.waitFor(() => {
      expect(detail).toHaveBeenCalledTimes(2)
      expect(list).toHaveBeenCalledTimes(2)
    })
  })

  test('an activity rollup on the hint lands in the cached agent rows without a refetch', async () => {
    const client = webQueryClient()
    const agent = {id: agentId, definition: {name: 'Researcher'}, status: 'idle'}
    const other = {id: 'agent-2', definition: {name: 'Other'}, status: 'idle'}
    const listFetch = vi.fn(async () => [agent, other])
    await client.fetchQuery({queryKey: ['agents', 'list', serverUrl, accountUid], queryFn: listFetch})
    const detailFetch = vi.fn(async () => ({_: 'GetAgentResponse', agent, sessions: []}))
    await client.fetchQuery({queryKey: ['agents', 'detail', serverUrl, accountUid, agentId], queryFn: detailFetch})

    const activity = {at: 5, kind: 'agent', messageAt: 5, messageFrom: 'agent', sessionId: 's1', busy: false} as const
    invalidateForAccountChange(serverUrl, accountUid, {reason: 'session-event', agentId, sessionId: 's1', activity})

    expect(client.getQueryData(['agents', 'list', serverUrl, accountUid])).toEqual([{...agent, activity}, other])
    expect(client.getQueryData(['agents', 'detail', serverUrl, accountUid, agentId])).toMatchObject({
      agent: {...agent, activity},
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(detailFetch).toHaveBeenCalledTimes(1)
  })

  test('per-event churn still only refetches active queries', async () => {
    const client = webQueryClient()
    const detail = await seedInactiveQuery(client, ['agents', 'detail', serverUrl, accountUid, agentId])

    invalidateForAccountChange(serverUrl, accountUid, {reason: 'session-event', agentId, sessionId: 'existing'})

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(detail).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(['agents', 'detail', serverUrl, accountUid, agentId])?.isInvalidated).toBe(true)
  })
})
