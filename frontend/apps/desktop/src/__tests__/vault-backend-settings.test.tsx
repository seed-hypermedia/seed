import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {VaultBackendMode, VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'

const {
  disconnectVaultMutateAsyncMock,
  forceVaultSyncMutateAsyncMock,
  openUrlMock,
  startVaultConnectionMutateAsyncMock,
  toastMock,
} = vi.hoisted(() => {
  return {
    startVaultConnectionMutateAsyncMock: vi.fn(),
    disconnectVaultMutateAsyncMock: vi.fn(),
    forceVaultSyncMutateAsyncMock: vi.fn(),
    openUrlMock: vi.fn(),
    toastMock: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
    }),
  }
})

const mockState = vi.hoisted(() => {
  return {
    vaultStatusData: null as any,
    vaultStatusFetching: false,
    startPending: false,
    disconnectPending: false,
    reminderPreference: {
      remindLaterUntilMs: null as number | null,
      dontRemindAgain: false,
    },
    setReminderPreference: vi.fn(),
  }
})

const trpcClientMock = vi.hoisted(() => {
  const mutateMock = vi.fn()
  const queryMock = vi.fn()
  let proxy: any
  proxy = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'mutate') return mutateMock
        if (prop === 'query') return queryMock
        return proxy
      },
    },
  )
  return proxy
})

vi.mock('@/models/app-settings', () => ({
  useAutoUpdatePreference: () => ({
    value: {data: 'true'},
    setAutoUpdate: vi.fn(),
  }),
  useRemoteVaultReminderPreference: () => ({
    value: {data: mockState.reminderPreference},
    setPreference: mockState.setReminderPreference,
  }),
}))

vi.mock('@/models/gateway-settings', () => ({
  useGatewayUrl: () => ({data: 'https://hyper.media'}),
  useNotifyServiceHost: () => undefined,
  usePushOnCopy: () => ({data: 'always', isLoading: false, isError: false, refetch: vi.fn()}),
  usePushOnPublish: () => ({data: 'always', isLoading: false, isError: false, refetch: vi.fn()}),
  useSetGatewayUrl: () => ({mutate: vi.fn()}),
  useSetNotifyServiceHost: () => ({mutate: vi.fn()}),
  useSetPushOnCopy: () => ({mutate: vi.fn()}),
  useSetPushOnPublish: () => ({mutate: vi.fn()}),
}))

vi.mock('@/models/daemon', () => ({
  useDaemonInfo: () => ({data: null}),
  useDeleteKey: () => ({mutateAsync: vi.fn()}),
  useDisconnectVault: () => ({
    isPending: mockState.disconnectPending,
    mutateAsync: disconnectVaultMutateAsyncMock,
  }),
  useExportKey: () => ({mutateAsync: vi.fn(), isPending: false}),
  useForceVaultSync: () => ({
    isPending: false,
    mutateAsync: forceVaultSyncMutateAsyncMock,
  }),
  useListKeys: () => ({data: []}),
  useSavedMnemonics: () => ({data: null, refetch: vi.fn()}),
  useStartVaultConnection: () => ({
    isPending: mockState.startPending,
    mutateAsync: startVaultConnectionMutateAsyncMock,
  }),
  useVaultStatus: () => ({
    data: mockState.vaultStatusData,
    isFetching: mockState.vaultStatusFetching,
  }),
}))

vi.mock('@/trpc', () => ({
  client: trpcClientMock,
}))

vi.mock('@/open-url', () => ({
  useOpenUrl: () => openUrlMock,
}))

vi.mock('@shm/ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@shm/ui/form-fields', async () => {
  const React = await import('react')

  return {
    Field: ({children, label}: any) =>
      React.createElement('label', null, label ? React.createElement('span', null, label) : null, children),
  }
})

vi.mock('@sentry/electron', () => ({}))
vi.mock('@sentry/electron/main', () => ({}))
vi.mock('@sentry/electron/renderer', () => ({}))
vi.mock('@sentry/electron/preload', () => ({}))

import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {VaultBackendSettings} from '../pages/settings'
import {buildVaultConnectionURL} from '../utils/vault-connection'

// Build the expected handoff URL from the resolved DAEMON_HTTP_URL so this test
// is independent of the developer's local env (which may override the port via
// DAEMON_HTTP_PORT / VITE_DESKTOP_HTTP_PORT).
function expectedHandoffUrl(vaultUrl: string, token: string) {
  const callback = encodeURIComponent(`${DAEMON_HTTP_URL}/vault-handoff`)
  return `${vaultUrl}/connect#token=${token}&callback=${callback}`
}

function renderComponent() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<VaultBackendSettings />)
  })
  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function findButton(container: HTMLDivElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined
}

function findRadio(container: HTMLDivElement, value: 'local' | 'remote') {
  return container.querySelector(`[data-slot="radio-group-item"][value="${value}"]`) as HTMLButtonElement | null
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', {bubbles: true}))
  input.dispatchEvent(new Event('change', {bubbles: true}))
}

describe('Vault backend settings', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.vaultStatusData = null
    mockState.vaultStatusFetching = false
    mockState.startPending = false
    mockState.disconnectPending = false
    mockState.reminderPreference = {
      remindLaterUntilMs: null,
      dontRemindAgain: false,
    }
    mockState.setReminderPreference.mockReset()
    startVaultConnectionMutateAsyncMock.mockReset()
    disconnectVaultMutateAsyncMock.mockReset()
    forceVaultSyncMutateAsyncMock.mockReset()
    openUrlMock.mockReset()
    toastMock.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('builds a browser handoff URL with daemon callback in fragment params', () => {
    const url = buildVaultConnectionURL('https://example.com/vault', 'handoff-token', 'http://localhost:56001')
    const parsed = new URL(url)
    const params = new URLSearchParams(parsed.hash.slice(1))

    expect(parsed.pathname).toBe('/vault/connect')
    expect(params.get('token')).toBe('handoff-token')
    expect(params.get('callback')).toBe('http://localhost:56001/vault-handoff')
  })

  it('builds a browser handoff URL that preserves the vault path', () => {
    const url = buildVaultConnectionURL('https://example.com/vault', 'handoff-token', 'http://localhost:56001')
    const parsed = new URL(url)
    const params = new URLSearchParams(parsed.hash.slice(1))

    expect(parsed.pathname).toBe('/vault/connect')
    expect(params.get('token')).toBe('handoff-token')
    expect(params.get('callback')).toBe('http://localhost:56001/vault-handoff')
  })

  it('starts remote vault handoff and opens the browser URL', async () => {
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.LOCAL,
      connectionStatus: VaultConnectionStatus.DISCONNECTED,
      remoteVaultUrl: '',
      syncStatus: {
        localVersion: BigInt(1),
        remoteVersion: BigInt(1),
      },
    }
    startVaultConnectionMutateAsyncMock.mockResolvedValue({
      vaultUrl: 'https://example.com/vault',
      handoffToken: 'token-123',
    })

    const {container, root} = renderComponent()

    const remoteRadio = findRadio(container, 'remote')
    expect(remoteRadio).toBeDefined()
    if (!remoteRadio) throw new Error('Remote radio not found')

    await act(async () => {
      remoteRadio.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const remoteURLInput = container.querySelector('#vault-remote-url') as HTMLInputElement
    expect(remoteURLInput).toBeDefined()

    await act(async () => {
      setInputValue(remoteURLInput, 'https://example.com/vault')
      await Promise.resolve()
    })

    await act(async () => {
      findButton(container, 'Connect Vault')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(startVaultConnectionMutateAsyncMock).toHaveBeenCalledWith({
      vaultUrl: 'https://example.com/vault',
      force: false,
    })
    expect(openUrlMock).toHaveBeenCalledWith(expectedHandoffUrl('https://example.com/vault', 'token-123'))

    cleanupRendered(root, container)
  })

  it('accepts a path-based remote vault URL', async () => {
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.LOCAL,
      connectionStatus: VaultConnectionStatus.DISCONNECTED,
      remoteVaultUrl: '',
      syncStatus: {
        localVersion: BigInt(1),
        remoteVersion: BigInt(1),
      },
    }
    startVaultConnectionMutateAsyncMock.mockResolvedValue({
      vaultUrl: 'https://example.com/vault',
      handoffToken: 'token-456',
    })

    const {container, root} = renderComponent()

    const remoteRadio = findRadio(container, 'remote')
    expect(remoteRadio).toBeDefined()
    if (!remoteRadio) throw new Error('Remote radio not found')

    await act(async () => {
      remoteRadio.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const remoteURLInput = container.querySelector('#vault-remote-url') as HTMLInputElement
    expect(remoteURLInput).toBeDefined()

    await act(async () => {
      setInputValue(remoteURLInput, 'https://example.com/vault/')
      await Promise.resolve()
    })

    await act(async () => {
      findButton(container, 'Connect Vault')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(startVaultConnectionMutateAsyncMock).toHaveBeenCalledWith({
      vaultUrl: 'https://example.com/vault',
      force: false,
    })
    expect(openUrlMock).toHaveBeenCalledWith(expectedHandoffUrl('https://example.com/vault', 'token-456'))

    cleanupRendered(root, container)
  })

  it('disconnects when switching from remote mode to local mode', async () => {
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.REMOTE,
      connectionStatus: VaultConnectionStatus.CONNECTED,
      remoteVaultUrl: 'https://example.com/vault',
      syncStatus: {
        localVersion: BigInt(4),
        remoteVersion: BigInt(4),
      },
    }
    disconnectVaultMutateAsyncMock.mockResolvedValue(undefined)

    const {container, root} = renderComponent()

    await act(async () => {
      await Promise.resolve()
    })

    const localRadio = findRadio(container, 'local')
    expect(localRadio).toBeDefined()
    if (!localRadio) throw new Error('Local radio not found')

    await act(async () => {
      localRadio.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(disconnectVaultMutateAsyncMock).toHaveBeenCalledTimes(1)

    cleanupRendered(root, container)
  })
})
