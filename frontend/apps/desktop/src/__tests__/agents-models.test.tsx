import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const getSettingMock = vi.fn()
const invalidateQueriesMock = vi.fn()
const setSettingMock = vi.fn()

const storeData: Record<string, any> = {}

vi.mock('@/trpc', () => ({
  client: {
    appSettings: {
      getSetting: {
        query: getSettingMock,
      },
      setSetting: {
        mutate: setSettingMock,
      },
    },
  },
}))

vi.mock('@/agents-client', () => ({
  getAgentServerHealth: vi.fn(),
  getAgentWebSocketUrl: vi.fn(),
  isSafeAgentServerSecretTarget: vi.fn(),
  normalizeAgentServerUrl: vi.fn((input: string) => new URL(input).toString().replace(/\/$/, '')),
  sendAgentAction: vi.fn(),
  signAgentAction: vi.fn(),
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
  queryClient: {
    removeQueries: vi.fn(),
    setQueriesData: vi.fn(),
  },
}))

function clearStoreData() {
  for (const key of Object.keys(storeData)) delete storeData[key]
}

function renderHook<T>(useHook: () => T) {
  let result: T
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {retry: false},
    },
  })

  function TestComponent() {
    result = useHook()
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>,
    )
  })

  return {
    container,
    queryClient,
    root,
    result: () => result,
  }
}

function cleanupRendered(root: Root, container: HTMLDivElement, queryClient: QueryClient) {
  act(() => {
    root.unmount()
  })
  queryClient.clear()
  container.remove()
}

async function waitForCondition(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('agent server models', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    clearStoreData()
    vi.clearAllMocks()
    process.env.NODE_ENV = 'test'
    getSettingMock.mockImplementation(async (key: string) => storeData[key] ?? null)
    setSettingMock.mockImplementation(async ({key, value}: {key: string; value: any}) => {
      storeData[key] = value
      return undefined
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    process.env.NODE_ENV = originalNodeEnv
  })

  it('seeds the configured server list with the built-in default in development', async () => {
    process.env.NODE_ENV = 'development'

    vi.resetModules()
    const mod = await import('../models/agents')
    const rendered = renderHook(() => mod.useAgentServerUrls())

    await waitForCondition(() => rendered.result().data !== undefined)

    expect(rendered.result().data).toEqual(['http://localhost:3050'])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('seeds the configured server list with the hosted default in production', async () => {
    process.env.NODE_ENV = 'production'

    vi.resetModules()
    const mod = await import('../models/agents')
    const rendered = renderHook(() => mod.useAgentServerUrls())

    await waitForCondition(() => rendered.result().data !== undefined)

    expect(rendered.result().data).toEqual(['https://agentic.seed.hyper.media'])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('does not re-seed the built-in default after the list is emptied in production', async () => {
    process.env.NODE_ENV = 'production'
    storeData['agent-server-urls'] = []

    vi.resetModules()
    const mod = await import('../models/agents')
    const rendered = renderHook(() => mod.useAgentServerUrls())

    await waitForCondition(() => rendered.result().data !== undefined)

    expect(rendered.result().data).toEqual([])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('clears the stored default when the configured server list becomes empty', async () => {
    storeData['agent-server-url'] = 'http://localhost:3050'
    storeData['agent-server-urls'] = ['http://localhost:3050']

    vi.resetModules()
    const mod = await import('../models/agents')
    const rendered = renderHook(() => mod.useSetAgentServerUrls())

    await act(async () => {
      await rendered.result().mutateAsync([])
    })

    expect(setSettingMock).toHaveBeenCalledWith({key: 'agent-server-urls', value: []})
    expect(setSettingMock).toHaveBeenCalledWith({key: 'agent-server-url', value: null})
    expect(storeData['agent-server-url']).toBeNull()
    expect(invalidateQueriesMock).toHaveBeenCalledWith(['agents'])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('uses the production default agent server in production builds', async () => {
    process.env.NODE_ENV = 'production'

    vi.resetModules()
    const mod = await import('../models/agents')

    expect(mod.DEFAULT_AGENT_SERVER_URL).toBe('https://agentic.seed.hyper.media')
  })
})
