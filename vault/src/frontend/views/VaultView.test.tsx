import {act, cleanup, render, waitFor} from '@testing-library/react'
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
