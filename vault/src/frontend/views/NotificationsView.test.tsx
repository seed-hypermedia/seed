import {act, cleanup, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as blobs from '@shm/shared/blobs'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createSuccessMockClient} from '@/frontend/test-utils'
import {NotificationsView} from './NotificationsView'

describe('NotificationsView', () => {
  afterEach(() => {
    cleanup()
  })

  function createVaultStore(names: string[] = ['Alice'], notificationServerUrl = '', createTime = 123456789) {
    const store = createStore(createSuccessMockClient(), createMockBlockstore(), '', notificationServerUrl)

    store.state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://vault.example.com',
      email: 'test@example.com',
      credentials: {},
    }
    store.state.decryptedDEK = new Uint8Array(32)

    const accounts = names.map((name) => {
      const seed = new Uint8Array(32)
      crypto.getRandomValues(seed)
      return {seed, createTime, delegations: []}
    })

    store.state.vaultData = {version: 2, accounts}
    store.state.selectedAccountIndex = 0

    const principals = accounts.map((a) => blobs.principalToString(blobs.nobleKeyPairFromSeed(a.seed).principal))

    return {store, principals}
  }

  test('renders the notification section for each account', async () => {
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
            <NotificationsView />
          </StoreContext.Provider>
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(screen.getByRole('heading', {name: 'Notifications', level: 1})).toBeDefined()
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
            <NotificationsView />
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
})
