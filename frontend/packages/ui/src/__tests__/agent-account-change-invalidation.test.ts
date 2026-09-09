import {QueryClient, QueryObserver} from '@tanstack/react-query'
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

  test('a hint with a session snapshot reorders the lists in place and refetches nothing on screen', async () => {
    const client = webQueryClient()
    const older = {id: 's-old', account: accountUid, agentId, status: 'idle' as const, createdAt: 100, updatedAt: 100}
    const session = {id: 's1', account: accountUid, agentId, status: 'idle' as const, createdAt: 200, updatedAt: 200}
    const listFetch = vi.fn(async () => [
      {serverUrl, session},
      {serverUrl, session: older},
    ])
    const transcriptFetch = vi.fn(async () => ({_: 'GetSessionResponse', session, events: []}))
    const detailFetch = vi.fn(async () => ({_: 'GetAgentResponse', agent: {id: agentId}, sessionCount: 2}))
    // The agent page's paginated session list, as the infinite query stores it.
    const pagesKey = ['agents', 'sessions', serverUrl, accountUid, 'agent', agentId]
    client.setQueryData(pagesKey, {pages: [{sessions: [session, older]}], pageParams: [undefined]})
    // On screen: an observer on each, the way a mounted sidebar, transcript and agent page hold them.
    const observed = [
      new QueryObserver(client, {queryKey: ['agents', 'sessions', serverUrl, accountUid], queryFn: listFetch}),
      new QueryObserver(client, {
        queryKey: ['agents', 'session', serverUrl, accountUid, 's1'],
        queryFn: transcriptFetch,
      }),
      new QueryObserver(client, {queryKey: ['agents', 'detail', serverUrl, accountUid, agentId], queryFn: detailFetch}),
    ]
    const unsubscribe = observed.map((observer) => observer.subscribe(() => {}))
    await vi.waitFor(() => {
      expect(listFetch).toHaveBeenCalledTimes(1)
      expect(transcriptFetch).toHaveBeenCalledTimes(1)
      expect(detailFetch).toHaveBeenCalledTimes(1)
    })

    const fresh = {...session, status: 'streaming' as const, updatedAt: 300}
    invalidateForAccountChange(serverUrl, accountUid, {
      reason: 'session-event',
      agentId,
      sessionId: 's1',
      session: fresh,
    })

    // Written straight into every cache that shows the session.
    expect(client.getQueryData(['agents', 'sessions', serverUrl, accountUid])).toEqual([
      {serverUrl, session: fresh},
      {serverUrl, session: older},
    ])
    expect(client.getQueryData(['agents', 'session', serverUrl, accountUid, 's1'])).toMatchObject({session: fresh})
    expect(client.getQueryData(pagesKey)).toMatchObject({pages: [{sessions: [fresh, older]}]})
    // And none of the mounted copies went back to the server — this was three refetches per hint.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(transcriptFetch).toHaveBeenCalledTimes(1)
    expect(detailFetch).toHaveBeenCalledTimes(1)
    // Still marked stale, so a remount would refetch.
    expect(client.getQueryState(['agents', 'session', serverUrl, accountUid, 's1'])?.isInvalidated).toBe(true)
    for (const stop of unsubscribe) stop()
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
