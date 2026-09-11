import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The Agents home page lists the account's sessions across every server, newest activity first,
 * paged. Each server pages independently; "load more" must advance every server that still has a
 * cursor, and the merged list must stay ordered and free of duplicates.
 */

type FakeSession = {id: string; agentId: string; updatedAt: number}

const mockState = vi.hoisted(() => ({
  servers: {} as Record<string, FakeSession[]>,
  calls: [] as Array<{serverUrl: string; cursor?: unknown}>,
  failing: new Set<string>(),
}))

vi.mock('@shm/ui/agents/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/ui/agents/client')>()),
  sendAgentAction: async ({serverUrl, action}: {serverUrl: string; action: any}) => {
    if (action._ !== 'ListSessions') throw new Error(`unexpected action ${action._}`)
    mockState.calls.push({serverUrl, cursor: action.cursor})
    if (mockState.failing.has(serverUrl)) throw new Error('server down')
    const all = [...(mockState.servers[serverUrl] ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)
    const after = action.cursor ? all.filter((s) => s.updatedAt < action.cursor.updatedBefore) : all
    const page = after.slice(0, action.limit)
    const last = page[page.length - 1]
    return {
      _: 'ListSessionsResponse',
      sessions: page.map((s) => ({...s, account: 'a', status: 'idle', createdAt: s.updatedAt})),
      agents: [{id: 'agent-1', definition: {name: 'Helper'}}],
      ...(after.length > page.length && last ? {nextCursor: {updatedBefore: last.updatedAt, idBefore: last.id}} : {}),
    }
  },
}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

import {useAllAgentSessionPages} from '@shm/ui/agents/models'

const SERVERS = ['https://one.example', 'https://two.example']
let container: HTMLDivElement
let root: Root
let latest: ReturnType<typeof useAllAgentSessionPages> | null = null

function Probe() {
  latest = useAllAgentSessionPages(SERVERS, 'account-1')
  return null
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
  })
  await settle()
}

function sessions(server: string, count: number, newest: number) {
  return Array.from({length: count}, (_, i) => ({id: `${server}-${i}`, agentId: 'agent-1', updatedAt: newest - i * 10}))
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.servers = {}
  mockState.calls = []
  mockState.failing = new Set()
  latest = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useAllAgentSessionPages', () => {
  it('merges every server newest-first and labels rows with their agent', async () => {
    mockState.servers = {[SERVERS[0]!]: sessions('one', 2, 1000), [SERVERS[1]!]: sessions('two', 2, 1005)}
    await render()

    expect(latest!.isLoading).toBe(false)
    expect(latest!.entries.map((e) => e.session.id)).toEqual(['two-0', 'one-0', 'two-1', 'one-1'])
    expect(latest!.entries[0]!.agent?.definition.name).toBe('Helper')
    expect(latest!.hasNextPage).toBe(false)
  })

  it('pages every server that still has a cursor, without duplicating rows', async () => {
    // 120 rows on server one and 30 on two, against a page size of 50.
    mockState.servers = {[SERVERS[0]!]: sessions('one', 120, 100000), [SERVERS[1]!]: sessions('two', 30, 100000)}
    await render()
    expect(latest!.entries).toHaveLength(80)
    expect(latest!.hasNextPage).toBe(true)

    act(() => latest!.fetchNextPage())
    await settle()
    expect(latest!.entries).toHaveLength(130)
    // Only server one had more; server two was not asked again.
    expect(mockState.calls.filter((c) => c.serverUrl === SERVERS[1] && c.cursor)).toHaveLength(0)
    expect(latest!.hasNextPage).toBe(true)

    act(() => latest!.fetchNextPage())
    await settle()
    expect(latest!.entries).toHaveLength(150)
    expect(new Set(latest!.entries.map((e) => `${e.serverUrl}:${e.session.id}`)).size).toBe(150)
    expect(latest!.hasNextPage).toBe(false)
    const times = latest!.entries.map((e) => e.session.updatedAt)
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('keeps the other servers listed when one fails, and names the failure', async () => {
    mockState.servers = {[SERVERS[1]!]: sessions('two', 3, 500)}
    mockState.failing.add(SERVERS[0]!)
    await render()

    expect(latest!.entries.map((e) => e.session.id)).toEqual(['two-0', 'two-1', 'two-2'])
    expect(latest!.serverErrors.map((e) => e.serverUrl)).toEqual([SERVERS[0]])
    expect(latest!.isLoading).toBe(false)
  })
})
