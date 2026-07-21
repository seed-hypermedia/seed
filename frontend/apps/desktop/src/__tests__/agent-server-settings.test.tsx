import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {ResizeObserver?: typeof ResizeObserver}).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {setDefaultServerMutateAsync, setServersMutateAsync, toastErrorMock, toastSuccessMock} = vi.hoisted(() => ({
  setDefaultServerMutateAsync: vi.fn(),
  setServersMutateAsync: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

let mockDefaultServer = 'http://localhost:3050'
/** Servers persisted in settings — the only ones this UI may add to or remove from. */
let mockServers: string[] = ['http://localhost:3050']
/** The desktop-managed server, which is always shown but never persisted. */
let mockLocalServer: string | null = null

vi.mock('@/models/agents', () => ({
  DEFAULT_AGENT_SERVER_URL: 'http://localhost:3050',
  LOCAL_AGENT_SERVER_LABEL: 'Local Agents',
  useAgentServerHealth: () => ({isError: true, isLoading: false}),
  useAgentServerUrl: () => ({data: mockDefaultServer}),
  useConfiguredAgentServerUrls: () => ({data: mockServers}),
  useLocalAgentServerUrl: () => ({data: mockLocalServer}),
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

import {TooltipProvider} from '@shm/ui/tooltip'
import {AgentServersSettings} from '../pages/settings'

function renderSettings() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <TooltipProvider>
        <AgentServersSettings />
      </TooltipProvider>,
    )
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
    mockLocalServer = null
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

    const confirmRemoveButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button !== removeButton && button.textContent?.trim() === 'Remove',
    ) as HTMLButtonElement | undefined

    expect(confirmRemoveButton).toBeDefined()

    await act(async () => {
      confirmRemoveButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
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

  it('always lists the desktop-managed server and offers no way to remove it', () => {
    // The local server's port is assigned at startup, so it must never reach the persisted list —
    // a stored value would be a dead entry the next time the port moves. It is therefore rendered
    // from its own hook and has no remove action.
    mockLocalServer = 'http://localhost:3051'
    mockServers = ['https://agentic.seed.hyper.media']

    const {container, root} = renderSettings()

    expect(container.textContent).toContain('Local Agents')
    expect(container.textContent).toContain('Built-in')
    expect(container.textContent).toContain('https://agentic.seed.hyper.media')

    // Exactly one remove control, belonging to the configured server rather than the built-in one.
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (element) => element.textContent?.trim() === 'Remove',
    )
    expect(removeButtons).toHaveLength(1)

    cleanupRendered(root, container)
  })

  it('still shows the desktop-managed server when nothing is configured', () => {
    mockLocalServer = 'http://localhost:3051'
    mockServers = []

    const {container, root} = renderSettings()

    expect(container.textContent).toContain('Local Agents')
    expect(container.textContent).not.toContain('No agent servers configured.')

    cleanupRendered(root, container)
  })
})
