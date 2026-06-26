import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createSuccessMockClient} from '@/frontend/test-utils'
import * as blobs from '@shm/shared/blobs'
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {AccountSettingsView} from './AccountSettingsView'

function renderAt(initialEntry: string | {pathname: string; hash: string}, store: ReturnType<typeof createStore>) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <StoreContext.Provider value={store}>
        <Routes>
          <Route path="/" element={<AccountSettingsView />} />
          <Route path="/settings" element={<AccountSettingsView />} />
        </Routes>
      </StoreContext.Provider>
    </MemoryRouter>,
  )
}

function accountEntry(principal: string) {
  return {pathname: '/', hash: `#/a/${encodeURIComponent(principal)}`}
}

describe('AccountSettingsView', () => {
  afterEach(() => {
    cleanup()
  })

  function createVaultStore(names = ['Alice', 'Bob']) {
    const store = createStore(createSuccessMockClient(), createMockBlockstore(), 'https://daemon.example.com', '')
    store.state.sessionChecked = true
    store.state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://example.com',
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
        return {seed, createTime: 123456789, delegations: []}
      }),
    }
    store.state.selectedAccountIndex = 0
    return {store, principals}
  }

  test('selects the account from the route and lists the accounts in the sidebar', async () => {
    const originalFetch = global.fetch
    global.fetch = mock(async () => new Response('{}', {status: 200})) as unknown as typeof fetch
    const {store, principals} = createVaultStore()

    try {
      renderAt(accountEntry(principals[1]!), store)

      await waitFor(() => {
        expect(store.state.selectedAccountIndex).toBe(1)
      })
      // Alice appears in the sidebar; Bob appears in both the sidebar and the
      // selected account's detail header.
      expect(screen.getByText('Alice')).toBeDefined()
      expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
    } finally {
      global.fetch = originalFetch
    }
  })

  test('selects another account when its sidebar entry is clicked', async () => {
    const originalFetch = global.fetch
    global.fetch = mock(async () => new Response('{}', {status: 200})) as unknown as typeof fetch
    const {store, principals} = createVaultStore()

    try {
      renderAt(accountEntry(principals[0]!), store)

      await waitFor(() => {
        expect(store.state.selectedAccountIndex).toBe(0)
      })

      fireEvent.click(screen.getByText('Bob').closest('button')!)

      await waitFor(() => {
        expect(store.state.selectedAccountIndex).toBe(1)
      })
    } finally {
      global.fetch = originalFetch
    }
  })

  test('restores the hash account after unlock instead of redirecting while loading', async () => {
    // Simulates the unlock gap: the view mounts (decryptedDEK set) before
    // loadVaultData populates the accounts. The restored hash must survive so the
    // user lands back on the same account.
    const originalFetch = global.fetch
    global.fetch = mock(async () => new Response('{}', {status: 200})) as unknown as typeof fetch
    const {store, principals} = createVaultStore()
    const loadedVault = store.state.vaultData
    store.state.vaultData = null

    try {
      renderAt(accountEntry(principals[1]!), store)

      // Vault data arrives a tick later.
      await act(async () => {
        store.state.vaultData = loadedVault
      })

      await waitFor(() => {
        expect(store.state.selectedAccountIndex).toBe(1)
      })
      // Did not get bounced to Vault Settings.
      expect(screen.queryByText('Security')).toBeNull()
    } finally {
      global.fetch = originalFetch
    }
  })

  test('shows and dismisses the desktop connection success banner', async () => {
    const originalFetch = global.fetch
    global.fetch = mock(async () => new Response('{}', {status: 200})) as unknown as typeof fetch
    const {store, principals} = createVaultStore(['Alice'])
    store.state.vaultConnectionSuccessMessage =
      'Your Seed desktop app has been linked with this remote vault successfully.'

    try {
      renderAt(accountEntry(principals[0]!), store)

      expect(screen.getByText('Desktop app connected')).toBeTruthy()
      expect(
        screen.getByText('Your Seed desktop app has been linked with this remote vault successfully.'),
      ).toBeTruthy()

      fireEvent.click(screen.getByRole('button', {name: 'Dismiss desktop app connected message'}))

      await waitFor(() => {
        expect(store.state.vaultConnectionSuccessMessage).toBe('')
      })
      expect(screen.queryByText('Desktop app connected')).toBeNull()
    } finally {
      global.fetch = originalFetch
    }
  })
})
