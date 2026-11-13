import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {ResizeObserver?: typeof ResizeObserver}).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {setDefaultServerMutateAsync, setServersMutateAsync, setLocalEnabledMutate, toastErrorMock, toastSuccessMock} =
  vi.hoisted(() => ({
    setDefaultServerMutateAsync: vi.fn(),
    setServersMutateAsync: vi.fn(),
    setLocalEnabledMutate: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
  }))

let mockDefaultServer = 'http://localhost:3050'
/** Servers persisted in settings — the only ones this UI may add to or remove from. */
let mockServers: string[] = ['http://localhost:3050']
/** The desktop-managed server, which is always shown but never persisted. */
let mockLocalServer: string | null = null
/** What the main process reports about the bundled server. */
let mockLocalState: {t: string; url?: string; message?: string} = {t: 'disabled', reason: 'setting'} as any
/** The platform seam: the local-server switch exists only where `setLocalServerEnabled` does. */
let mockPlatform: Record<string, unknown> = {setLocalServerEnabled: vi.fn()}
vi.mock('@shm/ui/agents/platform', () => ({getAgentsPlatform: () => mockPlatform}))

vi.mock('@shm/ui/agents/models', () => ({
  getDefaultAgentServerUrl: () => 'http://localhost:3050',
  LOCAL_AGENT_SERVER_LABEL: 'Local app environment',
  useAgentServerHealth: () => ({isError: true, isLoading: false}),
  useAgentServerUrl: () => ({data: mockDefaultServer}),
  useConfiguredAgentServerUrls: () => ({data: mockServers}),
  useLocalAgentServerUrl: () => ({data: mockLocalServer}),
  useLocalAgentServerState: () => ({data: mockLocalState, isLoading: false}),
  useSetLocalAgentServerEnabled: () => ({mutate: setLocalEnabledMutate, isLoading: false}),
  useSetAgentServerUrl: () => ({mutateAsync: setDefaultServerMutateAsync}),
  useSetAgentServerUrls: () => ({isLoading: false, mutateAsync: setServersMutateAsync}),
}))

let mockAccountId: string | null = 'z6MkAlice'
vi.mock('@shm/ui/agents/account', () => ({useSelectedAccountId: () => mockAccountId}))
vi.mock('@shm/ui/agents/dialogs', () => ({
  ManageAgentAccountsDialog: () => <div>ACCOUNTS DIALOG</div>,
  ModelProvidersDialog: () => <div>PROVIDERS DIALOG</div>,
}))

// The real hook needs a navigation provider; the dialogs here only need to open in place.
vi.mock('@shm/ui/universal-dialog', async () => {
  const {useState} = await import('react')
  return {
    useAppDialog: (Component: React.ComponentType<{input: unknown; onClose: () => void}>) => {
      const [input, setInput] = useState<unknown>(null)
      return {
        open: setInput,
        close: () => setInput(null),
        content: input ? <Component input={input} onClose={() => setInput(null)} /> : null,
      }
    },
  }
})

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
import {AgentServersSettings} from '@shm/ui/agents/server-settings'

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
    mockLocalState = {t: 'disabled', reason: 'setting'} as any
    mockPlatform = {setLocalServerEnabled: vi.fn()}
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

  it("opens each server's Accounts and Providers dialogs, the only place they live now", () => {
    const {container, root} = renderSettings()
    const buttons = Array.from(container.querySelectorAll('button'))
    const accounts = buttons.find((button) => button.textContent?.trim() === 'Accounts')
    const providers = buttons.find((button) => button.textContent?.trim() === 'Providers')
    expect(accounts).toBeTruthy()
    expect(providers).toBeTruthy()
    act(() => providers!.click())
    expect(document.body.textContent).toContain('PROVIDERS DIALOG')
    act(() => accounts!.click())
    expect(document.body.textContent).toContain('ACCOUNTS DIALOG')
    cleanupRendered(root, container)
  })

  it('hides Accounts and Providers without an account to sign their requests', () => {
    mockAccountId = null
    const {container, root} = renderSettings()
    expect(container.textContent).not.toContain('Accounts')
    expect(container.textContent).not.toContain('Providers')
    mockAccountId = 'z6MkAlice'
    cleanupRendered(root, container)
  })

  it('shows an empty state when no app environments are configured', () => {
    mockServers = []

    const {container, root} = renderSettings()

    expect(container.textContent).toContain('No app environments configured.')

    cleanupRendered(root, container)
  })

  it('offers the local server switch where the platform runs one, off by default, and turns it on', () => {
    mockServers = ['https://agentic.seed.hyper.media']
    const {container, root} = renderSettings()

    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!
    expect(toggle).toBeTruthy()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(container.textContent).toContain('Off by default')
    act(() => toggle.click())
    expect(setLocalEnabledMutate).toHaveBeenCalledWith(true, expect.anything())
    act(() => root.unmount())
  })

  it('shows the switch on and locked while attached to a development server, and hides it on the web', () => {
    mockLocalServer = 'http://localhost:3051'
    mockLocalState = {t: 'attached', url: 'http://localhost:3051'}
    const {container, root} = renderSettings()
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.disabled).toBe(true)
    expect(container.textContent).toContain('Attached to the app environment already running')
    act(() => root.unmount())

    mockPlatform = {}
    const second = renderSettings()
    expect(second.container.querySelector('button[role="switch"]')).toBeNull()
    act(() => second.root.unmount())
  })

  it('always lists the desktop-managed server and offers no way to remove it', () => {
    // The local server's port is assigned at startup, so it must never reach the persisted list —
    // a stored value would be a dead entry the next time the port moves. It is therefore rendered
    // from its own hook and has no remove action.
    mockLocalServer = 'http://localhost:3051'
    mockServers = ['https://agentic.seed.hyper.media']

    const {container, root} = renderSettings()

    expect(container.textContent).toContain('Local app environment')
    // "Local app environment" alone says it; a "Built-in" tag next to it was redundant.
    expect(container.textContent).not.toContain('Built-in')
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

    expect(container.textContent).toContain('Local app environment')
    expect(container.textContent).not.toContain('No app environments configured.')

    cleanupRendered(root, container)
  })
})
