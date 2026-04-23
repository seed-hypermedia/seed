import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {ResizeObserver?: typeof ResizeObserver}).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {VaultBackendMode, VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'

const mockState = vi.hoisted(() => ({
  vaultStatusData: null as any,
  listKeysData: [] as Array<{accountId: string; name: string; publicKey: string}>,
  startPending: false,
  disconnectPending: false,
  initialAccountIdCount: 0,
}))

const createAccountGate = vi.hoisted(() => ({
  promise: null as Promise<never> | null,
}))

const genMnemonicMock = vi.hoisted(() =>
  vi.fn<[], Promise<{mnemonic: string[]}>>(() => {
    if (!createAccountGate.promise) {
      createAccountGate.promise = new Promise<never>(() => {})
    }
    return createAccountGate.promise as unknown as Promise<{mnemonic: string[]}>
  }),
)
const registerKeyMutateAsyncMock = vi.hoisted(() => vi.fn())
const updateProfileMock = vi.hoisted(() => vi.fn())
const postAccountCreateActionMock = vi.hoisted(() => vi.fn())
const setSelectedIdentityMock = vi.fn()
const onCompleteMock = vi.fn()
const openUrlMock = vi.fn()
const startVaultConnectionMutateAsyncMock = vi.fn()
const disconnectVaultMutateAsyncMock = vi.fn()
const subscriptionsSubscribeMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
)

vi.mock('@/models/daemon', () => ({
  useDisconnectVault: () => ({
    isPending: mockState.disconnectPending,
    mutateAsync: disconnectVaultMutateAsyncMock,
  }),
  useImportKey: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useListKeys: () => ({
    data: mockState.listKeysData,
    isFetching: false,
  }),
  useRegisterKey: () => ({
    mutateAsync: registerKeyMutateAsyncMock,
  }),
  useStartVaultConnection: () => ({
    isPending: mockState.startPending,
    mutateAsync: startVaultConnectionMutateAsyncMock,
  }),
  useVaultStatus: () => ({
    data: mockState.vaultStatusData,
    isFetching: false,
  }),
}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    daemon: {
      genMnemonic: genMnemonicMock,
    },
    documents: {
      updateProfile: updateProfileMock,
    },
    subscriptions: {
      subscribe: subscriptionsSubscribeMock,
    },
  },
}))

vi.mock('@/desktop-universal-client', () => ({
  desktopUniversalClient: {
    getSigner: vi.fn(),
    publish: vi.fn(),
  },
}))

vi.mock('@/trpc', () => ({
  client: {
    secureStorage: {
      write: {mutate: vi.fn()},
    },
  },
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/utils/file-upload', () => ({
  fileUpload: vi.fn(),
}))

vi.mock('../app-context', () => ({
  useAppContext: () => ({
    pickKeyImportFile: vi.fn(),
  }),
}))

vi.mock('../app-onboarding', () => ({
  cleanupOnboardingFormData: vi.fn(),
  getOnboardingState: () => ({
    hasCompletedOnboarding: false,
    hasSkippedOnboarding: false,
    currentStep: 'welcome',
    formData: {name: '', icon: undefined},
    initialAccountIdCount: mockState.initialAccountIdCount,
  }),
  resetOnboardingState: vi.fn(),
  setHasCompletedOnboarding: vi.fn(),
  setHasSkippedOnboarding: vi.fn(),
  setInitialAccountIdCount: vi.fn(),
  setOnboardingFormData: vi.fn(),
  setOnboardingStep: vi.fn(),
  validateImage: vi.fn(),
  ImageValidationError: class ImageValidationError extends Error {},
}))

vi.mock('../pages/image-form', async () => {
  const React = await import('react')
  return {
    ImageForm: () => React.createElement('div', {'data-testid': 'image-form'}),
  }
})

vi.mock('@shm/shared', () => ({
  eventStream: () => [vi.fn(), {subscribe: () => () => {}}],
  postAccountCreateAction: postAccountCreateActionMock,
  useOpenUrl: () => openUrlMock,
  useUniversalAppContext: () => ({
    selectedIdentity: null,
    setSelectedIdentity: setSelectedIdentityMock,
  }),
}))

vi.mock('@shm/shared/constants', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/constants')>('@shm/shared/constants')
  return {
    ...actual,
    DAEMON_HTTP_URL: 'http://localhost:58001',
    IS_PROD_DESKTOP: false,
  }
})

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: vi.fn(),
}))

vi.mock('@shm/shared/utils/entity-id-url', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/utils/entity-id-url')>(
    '@shm/shared/utils/entity-id-url',
  )
  return {
    ...actual,
    hmId: (id: string) => ({uid: id}),
  }
})

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'library'}),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@sentry/electron', () => ({}))
vi.mock('@sentry/electron/main', () => ({}))
vi.mock('@sentry/electron/renderer', () => ({}))
vi.mock('@sentry/electron/preload', () => ({}))

import {Onboarding} from '../components/onboarding'

function renderComponent({modal = true}: {modal?: boolean} = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {retry: false},
    },
  })

  const render = () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Onboarding modal={modal} onComplete={onCompleteMock} />
        </QueryClientProvider>,
      )
    })
  }

  render()

  return {
    container,
    root,
    queryClient,
    rerender: render,
  }
}

function cleanupRendered(root: Root, container: HTMLDivElement, queryClient: QueryClient) {
  act(() => {
    root.unmount()
  })
  queryClient.clear()
  container.remove()
}

function findButton(container: HTMLDivElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined
}

function findVaultModeRadio(container: HTMLDivElement, mode: 'local' | 'remote') {
  const radios = Array.from(container.querySelectorAll('input[type="radio"][name="vault-mode"]')) as HTMLInputElement[]
  return radios[mode === 'local' ? 0 : 1]
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', {bubbles: true}))
  input.dispatchEvent(new Event('change', {bubbles: true}))
}

async function reachVaultStep(container: HTMLDivElement) {
  await act(async () => {
    findButton(container, 'NEXT')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    await Promise.resolve()
  })

  const accountNameInput = container.querySelector('#account-name') as HTMLInputElement
  expect(accountNameInput).toBeDefined()

  await act(async () => {
    setInputValue(accountNameInput, 'Alice')
    await Promise.resolve()
  })

  await act(async () => {
    findButton(container, 'NEXT')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    await Promise.resolve()
  })
}

async function clickBackButton(container: HTMLDivElement) {
  const backButton = container.querySelector('button') as HTMLButtonElement | null
  expect(backButton).toBeDefined()

  await act(async () => {
    backButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    await Promise.resolve()
  })
}

describe('Onboarding flow', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.LOCAL,
      connectionStatus: VaultConnectionStatus.DISCONNECTED,
      remoteVaultUrl: '',
      syncStatus: undefined,
    }
    mockState.startPending = false
    mockState.disconnectPending = false
    mockState.listKeysData = []
    mockState.initialAccountIdCount = 0
    createAccountGate.promise = null
    setSelectedIdentityMock.mockReset()
    onCompleteMock.mockReset()
    openUrlMock.mockReset()
    startVaultConnectionMutateAsyncMock.mockReset()
    disconnectVaultMutateAsyncMock.mockReset()
    subscriptionsSubscribeMock.mockReset()
    genMnemonicMock.mockReset()
    genMnemonicMock.mockImplementation(() => {
      if (!createAccountGate.promise) {
        createAccountGate.promise = new Promise<never>(() => {})
      }
      return createAccountGate.promise
    })
    registerKeyMutateAsyncMock.mockReset()
    updateProfileMock.mockReset()
    postAccountCreateActionMock.mockReset()
    toastMock.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('exposes a SKIP button on the profile step in the full-screen (non-modal) flow', async () => {
    const {container, root, queryClient} = renderComponent({modal: false})

    await act(async () => {
      findButton(container, 'NEXT')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const skipButton = findButton(container, 'SKIP')
    expect(skipButton).toBeDefined()

    await act(async () => {
      skipButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(onCompleteMock).toHaveBeenCalled()

    cleanupRendered(root, container, queryClient)
  })

  it('shows vault choice before create, restore, and import actions', async () => {
    const {container, root, queryClient} = renderComponent()

    await reachVaultStep(container)

    expect(container.textContent).toContain('CHOOSE YOUR VAULT')
    expect(container.textContent).toContain('CREATE NEW ACCOUNT')
    expect(container.textContent).toContain('Restore from Recovery Phrase')
    expect(container.textContent).toContain('Import Key File')

    cleanupRendered(root, container, queryClient)
  })

  it('routes create new account to account creation without exposing recovery phrase UI', async () => {
    const {container, root, queryClient} = renderComponent()

    await reachVaultStep(container)

    await act(async () => {
      findButton(container, 'CREATE NEW ACCOUNT')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('CREATING YOUR SITE')
    expect(container.textContent).not.toContain('Secret Recovery Phrase')
    expect(container.textContent).not.toContain('Restore from Recovery Phrase')

    cleanupRendered(root, container, queryClient)
  })

  it('retries account creation without minting a second account', async () => {
    genMnemonicMock.mockResolvedValue({
      mnemonic: ['alpha', 'beta', 'gamma'],
    })
    registerKeyMutateAsyncMock.mockResolvedValue({
      accountId: 'z6Mkaccount',
      publicKey: 'z6Mkaccount',
      name: 'z6Mkaccount',
    })
    updateProfileMock.mockRejectedValueOnce(new Error('profile failed'))
    updateProfileMock.mockResolvedValue(undefined)
    postAccountCreateActionMock.mockResolvedValue(undefined)

    const {container, root, queryClient} = renderComponent()

    await reachVaultStep(container)

    await act(async () => {
      findButton(container, 'CREATE NEW ACCOUNT')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('profile failed')
    expect(genMnemonicMock).toHaveBeenCalledTimes(1)
    expect(registerKeyMutateAsyncMock).toHaveBeenCalledTimes(1)
    expect(updateProfileMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      findButton(container, 'Retry')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(genMnemonicMock).toHaveBeenCalledTimes(1)
    expect(registerKeyMutateAsyncMock).toHaveBeenCalledTimes(1)
    expect(updateProfileMock).toHaveBeenCalledTimes(2)

    cleanupRendered(root, container, queryClient)
  })

  it('keeps restore and import flows reachable after vault selection', async () => {
    const restoreRender = renderComponent()
    await reachVaultStep(restoreRender.container)

    await act(async () => {
      findButton(restoreRender.container, 'Restore from Recovery Phrase')?.dispatchEvent(
        new MouseEvent('click', {bubbles: true}),
      )
      await Promise.resolve()
    })

    expect(restoreRender.container.textContent).toContain('ADD EXISTING KEY')
    expect(restoreRender.container.textContent).toContain('Secret Recovery Phrase')

    cleanupRendered(restoreRender.root, restoreRender.container, restoreRender.queryClient)

    const importRender = renderComponent()
    await reachVaultStep(importRender.container)

    await act(async () => {
      findButton(importRender.container, 'Import Key File')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(importRender.container.textContent).toContain('IMPORT KEY FILE')
    expect(importRender.container.textContent).toContain('.hmkey.json')

    cleanupRendered(importRender.root, importRender.container, importRender.queryClient)
  })

  it('returns restore and import flows to vault choice when going back', async () => {
    const restoreRender = renderComponent()
    await reachVaultStep(restoreRender.container)

    await act(async () => {
      findButton(restoreRender.container, 'Restore from Recovery Phrase')?.dispatchEvent(
        new MouseEvent('click', {bubbles: true}),
      )
      await Promise.resolve()
    })

    await clickBackButton(restoreRender.container)

    expect(restoreRender.container.textContent).toContain('CHOOSE YOUR VAULT')

    cleanupRendered(restoreRender.root, restoreRender.container, restoreRender.queryClient)

    const importRender = renderComponent()
    await reachVaultStep(importRender.container)

    await act(async () => {
      findButton(importRender.container, 'Import Key File')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    await clickBackButton(importRender.container)

    expect(importRender.container.textContent).toContain('CHOOSE YOUR VAULT')

    cleanupRendered(importRender.root, importRender.container, importRender.queryClient)
  })

  it('blocks remote-sync onboarding progress until the remote vault is connected', async () => {
    const {container, root, queryClient} = renderComponent()

    await reachVaultStep(container)

    await act(async () => {
      findVaultModeRadio(container, 'remote')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(findButton(container, 'CREATE NEW ACCOUNT')?.disabled).toBe(true)
    expect(findButton(container, 'Restore from Recovery Phrase')?.disabled).toBe(true)
    expect(findButton(container, 'Import Key File')?.disabled).toBe(true)
    expect(container.textContent).toContain('Waiting for connection.')

    cleanupRendered(root, container, queryClient)
  })

  it('validates the remote vault URL before starting browser handoff', async () => {
    const {container, root, queryClient} = renderComponent()

    await reachVaultStep(container)

    await act(async () => {
      findVaultModeRadio(container, 'remote')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const remoteURLInput = container.querySelector('#onboarding-vault-url') as HTMLInputElement
    expect(remoteURLInput).toBeDefined()

    await act(async () => {
      setInputValue(remoteURLInput, 'notaurl')
      await Promise.resolve()
    })

    await act(async () => {
      findButton(container, 'Connect in Browser')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(startVaultConnectionMutateAsyncMock).not.toHaveBeenCalled()
    expect(openUrlMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('Invalid vault URL')

    cleanupRendered(root, container, queryClient)
  })

  it('starts browser handoff and unlocks remote-sync actions after returning connected', async () => {
    startVaultConnectionMutateAsyncMock.mockResolvedValue({
      vaultUrl: 'https://example.com/vault',
      handoffToken: 'token-123',
    })

    const rendered = renderComponent()
    await reachVaultStep(rendered.container)

    await act(async () => {
      findVaultModeRadio(rendered.container, 'remote')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const remoteURLInput = rendered.container.querySelector('#onboarding-vault-url') as HTMLInputElement
    expect(remoteURLInput).toBeDefined()

    await act(async () => {
      setInputValue(remoteURLInput, 'https://example.com/vault/')
      await Promise.resolve()
    })

    await act(async () => {
      findButton(rendered.container, 'Connect in Browser')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(startVaultConnectionMutateAsyncMock).toHaveBeenCalledWith({
      vaultUrl: 'https://example.com/vault',
      force: false,
    })
    expect(openUrlMock).toHaveBeenCalledWith(
      'https://example.com/vault/connect#token=token-123&callback=http%3A%2F%2Flocalhost%3A58001%2Fvault-handoff',
    )

    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.REMOTE,
      connectionStatus: VaultConnectionStatus.CONNECTED,
      remoteVaultUrl: 'https://example.com/vault',
      syncStatus: undefined,
    }
    rendered.rerender()

    expect(rendered.container.textContent).toContain('Remote vault connected.')
    expect(findButton(rendered.container, 'CREATE NEW ACCOUNT')?.disabled).toBe(false)
    expect(findButton(rendered.container, 'Restore from Recovery Phrase')?.disabled).toBe(false)
    expect(findButton(rendered.container, 'Import Key File')?.disabled).toBe(false)
    expect(findButton(rendered.container, 'Reconnect in Browser')).toBeDefined()

    cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
  })

  it('reconnects through the browser when a remote vault is already connected', async () => {
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.REMOTE,
      connectionStatus: VaultConnectionStatus.CONNECTED,
      remoteVaultUrl: 'https://example.com/vault',
      syncStatus: undefined,
    }
    startVaultConnectionMutateAsyncMock.mockResolvedValue({
      vaultUrl: 'https://example.com/vault',
      handoffToken: 'token-456',
    })

    const {container, root, queryClient} = renderComponent()
    await reachVaultStep(container)

    await act(async () => {
      await Promise.resolve()
    })

    expect(findVaultModeRadio(container, 'remote')?.checked).toBe(true)
    expect(findButton(container, 'Reconnect in Browser')).toBeDefined()

    await act(async () => {
      findButton(container, 'Reconnect in Browser')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(startVaultConnectionMutateAsyncMock).toHaveBeenCalledWith({
      vaultUrl: 'https://example.com/vault',
      force: true,
    })

    cleanupRendered(root, container, queryClient)
  })

  it('completes onboarding when remote sync imports accounts onto an empty device', async () => {
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.REMOTE,
      connectionStatus: VaultConnectionStatus.CONNECTED,
      remoteVaultUrl: 'https://example.com/vault',
      syncStatus: undefined,
    }
    mockState.listKeysData = [
      {
        accountId: 'hm://acc-123',
        name: 'remote-main',
        publicKey: 'z6Mkremote',
      },
    ]

    const {container, root, queryClient} = renderComponent()
    await reachVaultStep(container)

    await act(async () => {
      await Promise.resolve()
    })

    expect(onCompleteMock).toHaveBeenCalledTimes(1)
    expect(setSelectedIdentityMock).toHaveBeenCalledWith('hm://acc-123')
    expect(subscriptionsSubscribeMock).toHaveBeenCalledWith({
      account: 'hm://acc-123',
      path: '',
      recursive: true,
    })
    expect(toastMock.success).toHaveBeenCalledWith('Remote vault connected and accounts synced to this device.')

    cleanupRendered(root, container, queryClient)
  })

  it('reverts the mode toggle if disconnect fails while switching back to local only', async () => {
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.REMOTE,
      connectionStatus: VaultConnectionStatus.CONNECTED,
      remoteVaultUrl: 'https://example.com/vault',
      syncStatus: undefined,
    }
    disconnectVaultMutateAsyncMock.mockRejectedValue(new Error('boom'))

    const {container, root, queryClient} = renderComponent()
    await reachVaultStep(container)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      findVaultModeRadio(container, 'local')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(disconnectVaultMutateAsyncMock).toHaveBeenCalledTimes(1)
    expect(findVaultModeRadio(container, 'remote')?.checked).toBe(true)
    expect(toastMock.error).toHaveBeenCalledWith('Failed to disconnect remote vault: boom')

    cleanupRendered(root, container, queryClient)
  })
})
