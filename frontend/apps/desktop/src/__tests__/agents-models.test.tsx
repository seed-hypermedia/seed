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
const discoverEntityMock = vi.fn()
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
      discoverEntity: discoverEntityMock,
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
    discoverEntityMock.mockResolvedValue({state: 'DISCOVERY_TASK_IN_PROGRESS', version: ''})
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

  function emitOpenSessionEvent(socket: FakeWebSocket, seq: number, event: Record<string, unknown>) {
    socket.emit('message', {
      data: JSON.stringify({
        _: 'append',
        key: 'sessions/open-session',
        event: {id: `open-event-${seq}`, sessionId: 'open-session', seq, createdAt: seq, event},
      }),
    })
  }

  async function flushMicrotasks() {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  }

  it('runs bounded discovery for references on an account-level hint, without live subscriptions', async () => {
    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() =>
      mod.useAgentWebSocketSubscription('https://agents.test', 'account-1', 'account/account-1'),
    )
    const socket = FakeWebSocket.instances[0]!
    // Probes stay in flight for the whole test so sharing between hints is observable; a settled
    // probe is released, and a later hint for the same version may legitimately ask again.
    discoverEntityMock.mockImplementation(() => new Promise(() => {}))

    const hint = {
      _: 'change',
      key: 'account/account-1',
      value: {
        reason: 'session-event',
        agentId: 'agent-1',
        sessionId: 'background-session',
        references: [
          'hm://z6MkAgent/report?v=published-version',
          'hm://z6MkOwner/notes/:comments/z6MkAgent/01ABC',
          'https://example.com/not-hm',
        ],
      },
    }
    socket.emit('message', {data: JSON.stringify(hint)})
    await waitForCondition(() => discoverEntityMock.mock.calls.length === 2)

    // The produced document is pinned to its published version; the comment's target is discovered
    // recursively once (a comment has no document version to pin).
    expect(discoverEntityMock.mock.calls).toEqual(
      expect.arrayContaining([['hm://z6MkAgent/report', 'published-version'], ['hm://z6MkOwner/notes/**']]),
    )
    expect(syncSubscribeMock).not.toHaveBeenCalled()

    // The same hint reaching another socket in this window (or arriving twice) shares the probes.
    socket.emit('message', {data: JSON.stringify(hint)})
    await flushAsyncEvents()
    expect(discoverEntityMock).toHaveBeenCalledTimes(2)

    // A hint without references changes nothing.
    socket.emit('message', {
      data: JSON.stringify({_: 'change', key: 'account/account-1', value: {reason: 'session-updated'}}),
    })
    await flushAsyncEvents()
    expect(discoverEntityMock).toHaveBeenCalledTimes(2)

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
    expect(syncUnsubscribeMock).not.toHaveBeenCalled()
  })

  it('cancels a still-running hint probe when the account-level hook unmounts', async () => {
    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() =>
      mod.useAgentWebSocketSubscription('https://agents.test', 'account-1', 'account/account-1'),
    )
    const socket = FakeWebSocket.instances[0]!
    // The node keeps reporting an older version, so the pinned probe would keep polling.
    discoverEntityMock.mockResolvedValue({state: 'DISCOVERY_TASK_COMPLETED', version: 'older-version'})

    vi.useFakeTimers()
    try {
      socket.emit('message', {
        data: JSON.stringify({
          _: 'change',
          key: 'account/account-1',
          value: {reason: 'session-event', references: ['hm://z6MkAgent/report?v=new-version']},
        }),
      })
      await flushMicrotasks()
      expect(discoverEntityMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(discoverEntityMock).toHaveBeenCalledTimes(2)

      cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(discoverEntityMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pins the version from a write tool result until the local node reports it', async () => {
    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() =>
      mod.useAgentWebSocketSubscription('https://agents.test', 'account-1', 'sessions/open-session'),
    )
    const socket = FakeWebSocket.instances[0]!
    discoverEntityMock.mockResolvedValue({state: 'DISCOVERY_TASK_COMPLETED', version: 'published-version'})

    emitOpenSessionEvent(socket, 1, {
      type: 'tool_result',
      name: 'write',
      output: {id: 'hm://z6MkAgent/report', version: 'published-version', cids: []},
    })
    await waitForCondition(
      () => syncSubscribeMock.mock.calls.length === 1 && discoverEntityMock.mock.calls.length === 1,
    )

    // The live subscription still tracks "latest" for the whole session...
    expect(syncSubscribeMock).toHaveBeenCalledWith(
      {id: expect.objectContaining({id: 'hm://z6MkAgent/report', version: 'published-version'}), recursive: false},
      expect.objectContaining({onError: expect.any(Function)}),
    )
    // ...and the exact published version is requested once, without the ?v= query in the id.
    expect(discoverEntityMock).toHaveBeenCalledTimes(1)
    expect(discoverEntityMock).toHaveBeenCalledWith('hm://z6MkAgent/report', 'published-version')

    // A prose reference without a version only subscribes; nothing to pin.
    emitOpenSessionEvent(socket, 2, {type: 'message', role: 'assistant', content: 'Also see hm://z6MkAgent/other'})
    await waitForCondition(() => syncSubscribeMock.mock.calls.length === 2)
    expect(discoverEntityMock).toHaveBeenCalledTimes(1)

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
    expect(syncUnsubscribeMock).toHaveBeenCalledTimes(2)
  })

  it('keeps re-asking for the pinned version while the node holds an older one, and stops when the session closes', async () => {
    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() =>
      mod.useAgentWebSocketSubscription('https://agents.test', 'account-1', 'sessions/open-session'),
    )
    const socket = FakeWebSocket.instances[0]!
    discoverEntityMock
      .mockResolvedValueOnce({state: 'DISCOVERY_TASK_IN_PROGRESS', version: ''})
      .mockResolvedValueOnce({state: 'DISCOVERY_TASK_COMPLETED', version: 'older-version'})
      .mockResolvedValue({state: 'DISCOVERY_TASK_COMPLETED', version: 'older-version'})

    vi.useFakeTimers()
    try {
      emitOpenSessionEvent(socket, 1, {
        type: 'tool_result',
        name: 'write',
        output: {id: 'hm://z6MkAgent/report', version: 'new-version'},
      })
      await flushMicrotasks()
      expect(discoverEntityMock).toHaveBeenCalledTimes(1)

      // Still pending / stale after the first answer: the probe re-asks on its poll interval.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(discoverEntityMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(discoverEntityMock).toHaveBeenCalledTimes(3)
      expect(discoverEntityMock).toHaveBeenLastCalledWith('hm://z6MkAgent/report', 'new-version')

      // Closing the session cancels the probe along with the live subscription.
      cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
      expect(syncUnsubscribeMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(discoverEntityMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-pins when the same document is referenced again with a newer version', async () => {
    vi.resetModules()
    const mod = await import('@shm/ui/agents/models')
    const rendered = renderHook(() =>
      mod.useAgentWebSocketSubscription('https://agents.test', 'account-1', 'sessions/open-session'),
    )
    const socket = FakeWebSocket.instances[0]!
    discoverEntityMock.mockImplementation(async (_id: string, version?: string) => ({
      state: 'DISCOVERY_TASK_COMPLETED',
      version,
    }))

    emitOpenSessionEvent(socket, 1, {
      type: 'tool_result',
      name: 'write',
      output: {id: 'hm://z6MkAgent/report', version: 'v1'},
    })
    await waitForCondition(() => discoverEntityMock.mock.calls.length === 1)
    emitOpenSessionEvent(socket, 2, {
      type: 'tool_result',
      name: 'write',
      output: {id: 'hm://z6MkAgent/report', version: 'v2'},
    })
    await waitForCondition(() => discoverEntityMock.mock.calls.length === 2)

    expect(discoverEntityMock.mock.calls.map((call) => call[1])).toEqual(['v1', 'v2'])
    // The stale subscription for v1 was replaced by one for v2.
    expect(syncSubscribeMock).toHaveBeenCalledTimes(2)
    expect(syncUnsubscribeMock).toHaveBeenCalledTimes(1)

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
    expect(syncUnsubscribeMock).toHaveBeenCalledTimes(2)
  })
})
