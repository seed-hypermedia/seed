import {act, cleanup, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as blobs from '@shm/shared/blobs'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createSuccessMockClient} from '@/frontend/test-utils'
import {VaultView} from './VaultView'

describe('VaultView', () => {
  afterEach(() => {
    cleanup()
  })

  function createVaultStore(names = ['Alice'], notificationServerUrl = '', createTime = 123456789) {
    const store = createStore(
      createSuccessMockClient(),
      createMockBlockstore(),
      'https://daemon.example.com',
      notificationServerUrl,
    )
    store.state.sessionChecked = true
    store.state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://vault.example.com',
      email: 'test@example.com',
    }
    store.state.decryptedDEK = new Uint8Array(32)
    const principals: string[] = []
    store.state.vaultData = {
      version: 2,
      accounts: names.map((name, index) => {
        const seed = new Uint8Array(32).fill(index + 1)
        const principal = blobs.principalToString(blobs.nobleKeyPairFromSeed(seed).principal)
        principals.push(principal)
        store.state.profiles[principal] = {name}

        return {
          seed,
          createTime,
          delegations: [],
        }
      }),
    }
    store.state.selectedAccountIndex = principals.length > 0 ? 0 : -1

    return {store, principals}
  }

  test('renders the notification section for the selected account', async () => {
    const originalFetch = global.fetch
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          accountId: 'account-1',
          email: null,
          verifiedTime: null,
          verificationSendTime: null,
          verificationExpired: false,
          isRegistered: false,
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      )
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const {store} = createVaultStore(['Alice'], 'https://notify.example.com')

    try {
      render(
        <MemoryRouter>
          <StoreContext.Provider value={store}>
            <VaultView />
          </StoreContext.Provider>
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeDefined()
      })
      expect(screen.getByRole('button', {name: 'Register Account'})).toBeDefined()
    } finally {
      global.fetch = originalFetch
    }
  })

  test('shows a registration loading state for a recently created account until the server catches up', async () => {
    const originalFetch = global.fetch
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    let getConfigCount = 0
    const fetchMock = mock(async () => {
      getConfigCount += 1
      return new Response(
        JSON.stringify({
          accountId: 'account-1',
          email: null,
          verifiedTime: null,
          verificationSendTime: null,
          verificationExpired: false,
          isRegistered: getConfigCount >= 2,
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      )
    })
    const setIntervalMock = mock((callback: TimerHandler) => {
      return window.setTimeout(() => {
        ;(callback as () => void)()
      }, 10) as unknown as number
    })
    const clearIntervalMock = mock((timerId?: number) => {
      if (timerId != null) {
        window.clearTimeout(timerId)
      }
    })
    global.fetch = fetchMock as unknown as typeof fetch
    window.setInterval = setIntervalMock as unknown as typeof window.setInterval
    window.clearInterval = clearIntervalMock as unknown as typeof window.clearInterval
    const {store} = createVaultStore(['Alice'], 'https://notify.example.com', Date.now())

    try {
      render(
        <MemoryRouter>
          <StoreContext.Provider value={store}>
            <VaultView />
          </StoreContext.Provider>
        </MemoryRouter>,
      )

      expect(screen.getByText('Registering this account with notify.example.com.')).toBeDefined()

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 50))
      })

      await waitFor(() => {
        expect(screen.getByText('This account is registered with notify.example.com.')).toBeDefined()
        expect(screen.getByRole('button', {name: 'Set Notification Email'})).toBeDefined()
      })
    } finally {
      global.fetch = originalFetch
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
    }
  })

  test('selects the account from the hash route after unlock', async () => {
    const originalFetch = global.fetch
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          accountId: 'account-1',
          email: null,
          verifiedTime: null,
          verificationSendTime: null,
          verificationExpired: false,
          isRegistered: false,
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      )
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const {store, principals} = createVaultStore(['Alice', 'Bob'], 'https://notify.example.com')
    history.replaceState(null, '', '/vault')
    window.location.hash = `/a/${encodeURIComponent(principals[1]!)}`

    try {
      render(
        <MemoryRouter>
          <StoreContext.Provider value={store}>
            <VaultView />
          </StoreContext.Provider>
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(store.state.selectedAccountIndex).toBe(1)
      })
      expect(window.location.hash).toBe(`#/a/${encodeURIComponent(principals[1]!)}`)
    } finally {
      global.fetch = originalFetch
      history.replaceState(null, '', originalPath)
    }
  })

  test('updates the hash when the selected account changes', async () => {
    const originalFetch = global.fetch
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          accountId: 'account-1',
          email: null,
          verifiedTime: null,
          verificationSendTime: null,
          verificationExpired: false,
          isRegistered: false,
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      )
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const {store, principals} = createVaultStore(['Alice', 'Bob'], 'https://notify.example.com')
    history.replaceState(null, '', '/vault')

    try {
      render(
        <MemoryRouter>
          <StoreContext.Provider value={store}>
            <VaultView />
          </StoreContext.Provider>
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(window.location.hash).toBe(`#/a/${encodeURIComponent(principals[0]!)}`)
      })

      await act(async () => {
        store.actions.selectAccount(1)
      })

      await waitFor(() => {
        expect(store.state.selectedAccountIndex).toBe(1)
        expect(window.location.hash).toBe(`#/a/${encodeURIComponent(principals[1]!)}`)
      })
    } finally {
      global.fetch = originalFetch
      history.replaceState(null, '', originalPath)
    }
  })
})
