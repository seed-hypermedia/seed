import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'

const {sendAgentActionMock, invalidateQueriesMock} = vi.hoisted(() => ({
  sendAgentActionMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
}))

vi.mock('@shm/ui/agents/platform', () => ({
  getAgentsPlatform: () => ({
    defaultServerUrl: () => null,
    getSetting: vi.fn(),
    setSetting: vi.fn(),
  }),
  setAgentsPlatform: vi.fn(),
}))

vi.mock('@shm/ui/agents/client', () => ({
  getAgentServerHealth: vi.fn(),
  getAgentWebSocketUrl: vi.fn(),
  isSafeAgentServerSecretTarget: vi.fn(() => true),
  normalizeAgentServerUrl: vi.fn((input: string) => new URL(input).toString().replace(/\/$/, '')),
  sendAgentAction: sendAgentActionMock,
  signAgentAction: vi.fn(),
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
  queryClient: {
    removeQueries: vi.fn(),
    setQueriesData: vi.fn(),
  },
}))

import {useSaveModelProvider, useStartProviderOAuth} from '@shm/ui/agents/models'

function renderHook<T>(useHook: () => T) {
  let result: T
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})

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

  return {container, queryClient, root, result: () => result!}
}

function cleanupRendered(root: Root, container: HTMLDivElement, queryClient: QueryClient) {
  act(() => {
    root.unmount()
  })
  queryClient.clear()
  container.remove()
}

describe('subscription provider save flow', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('saves a subscription provider with only SetModelProvider, referencing the OAuth secret', async () => {
    sendAgentActionMock.mockResolvedValue({_: 'SetModelProviderResponse', provider: {}})
    const {container, queryClient, root, result} = renderHook(() =>
      useSaveModelProvider('https://agents.example.com', 'z6MkAccount'),
    )
    try {
      await act(async () => {
        await result().mutateAsync({
          type: 'openai',
          name: 'ChatGPT',
          apiKey: '',
          oauthSecretName: 'openai-subscription-oauth',
        })
      })
      // Exactly one action: no API-key secret write in subscription mode.
      expect(sendAgentActionMock).toHaveBeenCalledTimes(1)
      expect(sendAgentActionMock).toHaveBeenCalledWith({
        serverUrl: 'https://agents.example.com',
        accountUid: 'z6MkAccount',
        action: {
          _: 'SetModelProvider',
          name: 'ChatGPT',
          provider: {
            type: 'openai',
            authMode: 'subscription',
            secretRefs: {oauth: 'openai-subscription-oauth'},
          },
        },
      })
    } finally {
      cleanupRendered(root, container, queryClient)
    }
  })

  it('still writes an API-key secret first when no OAuth secret is provided', async () => {
    sendAgentActionMock.mockResolvedValue({_: 'SetSecretResponse'})
    const {container, queryClient, root, result} = renderHook(() =>
      useSaveModelProvider('https://agents.example.com', 'z6MkAccount'),
    )
    try {
      await act(async () => {
        await result().mutateAsync({type: 'openai', name: 'OpenAI', apiKey: 'sk-test'})
      })
      expect(sendAgentActionMock).toHaveBeenCalledTimes(2)
      expect(sendAgentActionMock.mock.calls[0]?.[0]?.action?._).toBe('SetSecret')
      expect(sendAgentActionMock.mock.calls[1]?.[0]?.action).toMatchObject({
        _: 'SetModelProvider',
        provider: {type: 'openai', secretRefs: {apiKey: 'OpenAI-api-key'}},
      })
    } finally {
      cleanupRendered(root, container, queryClient)
    }
  })

  it('starts a subscription sign-in and returns the browser auth URL', async () => {
    sendAgentActionMock.mockResolvedValue({
      _: 'StartProviderOAuthResponse',
      loginId: 'login-1',
      authUrl: 'https://auth.openai.com/oauth/authorize?x=1',
      expiresAt: 123,
    })
    const {container, queryClient, root, result} = renderHook(() =>
      useStartProviderOAuth('https://agents.example.com', 'z6MkAccount'),
    )
    try {
      let started: any
      await act(async () => {
        started = await result().mutateAsync('openai')
      })
      expect(started.authUrl).toContain('https://auth.openai.com/oauth/authorize')
      expect(sendAgentActionMock).toHaveBeenCalledWith({
        serverUrl: 'https://agents.example.com',
        accountUid: 'z6MkAccount',
        action: {_: 'StartProviderOAuth', providerType: 'openai'},
      })
    } finally {
      cleanupRendered(root, container, queryClient)
    }
  })
})
