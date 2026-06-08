import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {setDefaultServerMutateAsync, setServersMutateAsync, toastErrorMock, toastSuccessMock} = vi.hoisted(() => ({
  setDefaultServerMutateAsync: vi.fn(),
  setServersMutateAsync: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

let mockDefaultServer = 'http://localhost:3050'
let mockServers: string[] = ['http://localhost:3050']

vi.mock('@/models/agents', () => ({
  DEFAULT_AGENT_SERVER_URL: 'http://localhost:3050',
  useAgentServerHealth: () => ({isError: true, isLoading: false}),
  useAgentServerUrl: () => ({data: mockDefaultServer}),
  useAgentServerUrls: () => ({data: mockServers}),
  useSetAgentServerUrl: () => ({mutateAsync: setDefaultServerMutateAsync}),
  useSetAgentServerUrls: () => ({isLoading: false, mutateAsync: setServersMutateAsync}),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}))

vi.mock('@/trpc', () => ({
  client: {},
}))

vi.mock('@sentry/electron', () => ({}))
vi.mock('@sentry/electron/main', () => ({}))
vi.mock('@sentry/electron/renderer', () => ({}))
vi.mock('@sentry/electron/preload', () => ({}))

import {AgentServersSettings} from '../pages/settings'

function renderSettings() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<AgentServersSettings />)
  })

  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('AgentServersSettings', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockDefaultServer = 'http://localhost:3050'
    mockServers = ['http://localhost:3050']
    setDefaultServerMutateAsync.mockReset()
    setServersMutateAsync.mockReset()
    setDefaultServerMutateAsync.mockResolvedValue(undefined)
    setServersMutateAsync.mockResolvedValue(undefined)
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('removes the last configured server without re-adding the built-in default', async () => {
    const {container, root} = renderSettings()
    const removeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Remove'),
    ) as HTMLButtonElement | undefined

    expect(removeButton).toBeDefined()

    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(setServersMutateAsync).toHaveBeenCalledWith([])

    cleanupRendered(root, container)
  })

  it('shows an empty state when no agent servers are configured', () => {
    mockServers = []

    const {container, root} = renderSettings()

    expect(container.textContent).toContain('No agent servers configured.')

    cleanupRendered(root, container)
  })
})
