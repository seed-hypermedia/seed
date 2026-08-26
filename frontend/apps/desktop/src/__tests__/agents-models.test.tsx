import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const getSettingMock = vi.fn()
const invalidateQueriesMock = vi.fn()
const setSettingMock = vi.fn()
const syncSubscribeMock = vi.fn()
const syncUnsubscribeMock = vi.fn()
const getAgentServerHealthMock = vi.fn()
const getAgentWebSocketUrlMock = vi.fn()
const signAgentActionMock = vi.fn()

const storeData: Record<string, any> = {}

vi.mock('@shm/ui/agents/platform', async () => {
  const {getDefaultAgentServerUrl} = await import('@/agents-defaults')
  return {
    getAgentsPlatform: () => ({
      defaultServerUrl: () => getDefaultAgentServerUrl(),
      getSetting: getSettingMock,
      setSetting: setSettingMock,
      subscribeToEntity: syncSubscribeMock,
    }),
    setAgentsPlatform: vi.fn(),
  }
})

vi.mock('@shm/ui/agents/client', () => ({
  getAgentServerHealth: getAgentServerHealthMock,
  getAgentWebSocketUrl: getAgentWebSocketUrlMock,
  isSafeAgentServerSecretTarget: vi.fn(),
  normalizeAgentServerUrl: vi.fn((input: string) => new URL(input).toString().replace(/\/$/, '')),
  sendAgentAction: vi.fn(),
  signAgentAction: signAgentActionMock,
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
  queryClient: {
    removeQueries: vi.fn(),
    setQueriesData: vi.fn(),
  },
}))

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readonly listeners = new Map<string, Array<(event: any) => void>>()
  binaryType = ''
  readyState = FakeWebSocket.OPEN

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  send() {}
  close() {}
}

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

async function flushAsyncEvents() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitForCondition(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await flushAsyncEvents()
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
    setSettingMock.mockImplementation(async (key: string, value: any) => {
      storeData[key] = value
      return undefined
    })
    syncSubscribeMock.mockReturnValue({unsubscribe: syncUnsubscribeMock})
    getAgentServerHealthMock.mockResolvedValue({status: 'ok', uptime: 1})
    getAgentWebSocketUrlMock.mockReturnValue('ws://agents.test/agents/ws')
    signAgentActionMock.mockResolvedValue({action: {_: 'Subscribe'}, signature: new Uint8Array(), signer: 'test'})
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    process.env.NODE_ENV = originalNodeEnv
    vi.unstubAllGlobals()
  })

  it('seeds the configured server list with the built-in default in development', async () => {
    process.env.NODE_ENV = 'development'

    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const {DEFAULT_AGENT_SERVER_URL} = await import('@/agents-defaults')
    const rendered = renderHook(() => mod.useConfiguredAgentServerUrls())

    await waitForCondition(() => rendered.result().data !== undefined)

    expect(rendered.result().data).toEqual([DEFAULT_AGENT_SERVER_URL])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('seeds the configured server list with the hosted default in production', async () => {
    process.env.NODE_ENV = 'production'

    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const {DEFAULT_AGENT_SERVER_URL} = await import('@/agents-defaults')
    const rendered = renderHook(() => mod.useConfiguredAgentServerUrls())

    await waitForCondition(() => rendered.result().data !== undefined)

    expect(rendered.result().data).toEqual([DEFAULT_AGENT_SERVER_URL])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('does not re-seed the built-in default after the list is emptied in production', async () => {
    process.env.NODE_ENV = 'production'
    storeData['agent-server-urls'] = []

    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() => mod.useConfiguredAgentServerUrls())

    await waitForCondition(() => rendered.result().data !== undefined)

    expect(rendered.result().data).toEqual([])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('clears the stored default when the configured server list becomes empty', async () => {
    storeData['agent-server-url'] = 'http://localhost:3050'
    storeData['agent-server-urls'] = ['http://localhost:3050']

    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() => mod.useSetAgentServerUrls())

    await act(async () => {
      await rendered.result().mutateAsync([])
    })

    expect(setSettingMock).toHaveBeenCalledWith('agent-server-urls', [])
    expect(setSettingMock).toHaveBeenCalledWith('agent-server-url', null)
    expect(storeData['agent-server-url']).toBeNull()
    expect(invalidateQueriesMock).toHaveBeenCalledWith(['agents'])

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('uses the production default agent server in production builds', async () => {
    process.env.NODE_ENV = 'production'

    vi.resetModules()
    const {DEFAULT_AGENT_SERVER_URL} = await import('@/agents-defaults')

    expect(DEFAULT_AGENT_SERVER_URL).toBe('https://agentic.seed.hyper.media')
  })

  it('syncs references only for the mounted session and unsubscribes when it closes', async () => {
    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() =>
      mod.useAgentWebSocketSubscription('https://agents.test', 'account-1', 'sessions/open-session'),
    )
    const socket = FakeWebSocket.instances[0]!

    socket.emit('message', {
      data: JSON.stringify({
        _: 'append',
        key: 'sessions/background-session',
        event: {
          id: 'background-event',
          sessionId: 'background-session',
          seq: 1,
          createdAt: 1,
          event: {
            type: 'message',
            role: 'assistant',
            content: 'See hm://z6MkAgent/background?v=background-version',
          },
        },
      }),
    })
    await flushAsyncEvents()
    expect(syncSubscribeMock).not.toHaveBeenCalled()

    socket.emit('message', {
      data: JSON.stringify({
        _: 'append',
        key: 'sessions/open-session',
        event: {
          id: 'open-event',
          sessionId: 'open-session',
          seq: 1,
          createdAt: 1,
          event: {
            type: 'message',
            role: 'assistant',
            content: 'See hm://z6MkAgent/open?v=open-version',
          },
        },
      }),
    })
    await waitForCondition(() => syncSubscribeMock.mock.calls.length === 1)

    expect(syncSubscribeMock).toHaveBeenCalledWith(
      {
        id: expect.objectContaining({
          id: 'hm://z6MkAgent/open',
          version: 'open-version',
        }),
        recursive: false,
      },
      expect.objectContaining({onError: expect.any(Function)}),
    )

    socket.emit('message', {
      data: JSON.stringify({
        _: 'append',
        key: 'sessions/open-session',
        event: {
          id: 'comment-event',
          sessionId: 'open-session',
          seq: 2,
          createdAt: 2,
          event: {
            type: 'message',
            role: 'assistant',
            content: 'See hm://z6MkOwner/notes/:comments/z6MkAgent/01ABC',
          },
        },
      }),
    })
    await waitForCondition(() => syncSubscribeMock.mock.calls.length === 2)
    expect(syncSubscribeMock).toHaveBeenLastCalledWith(
      {
        id: expect.objectContaining({id: 'hm://z6MkOwner/notes'}),
        recursive: true,
      },
      expect.objectContaining({onError: expect.any(Function)}),
    )

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
    expect(syncUnsubscribeMock).toHaveBeenCalledTimes(2)
  })

  it('does not sync session references from an account-level background subscription', async () => {
    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() =>
      mod.useAgentWebSocketSubscription('https://agents.test', 'account-1', 'account/account-1'),
    )
    const socket = FakeWebSocket.instances[0]!

    socket.emit('message', {
      data: JSON.stringify({
        _: 'append',
        key: 'sessions/background-session',
        event: {
          id: 'background-event',
          sessionId: 'background-session',
          seq: 1,
          createdAt: 1,
          event: {
            type: 'message',
            role: 'assistant',
            content: 'See hm://z6MkAgent/background',
          },
        },
      }),
    })
    await flushAsyncEvents()

    expect(syncSubscribeMock).not.toHaveBeenCalled()
    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
    expect(syncUnsubscribeMock).not.toHaveBeenCalled()
  })
})
