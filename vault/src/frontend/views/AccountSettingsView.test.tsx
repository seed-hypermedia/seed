import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createSuccessMockClient} from '@/frontend/test-utils'
import * as blobs from '@shm/shared/blobs'
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import {MemoryRouter, Route, Routes} from 'react-router-dom'
import {AccountSettingsView} from './AccountSettingsView'

function renderAt(initialPath: string, store: ReturnType<typeof createStore>) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <StoreContext.Provider value={store}>
        <Routes>
          <Route path="/" element={<AccountSettingsView />} />
          <Route path="/settings" element={<AccountSettingsView />} />
          <Route path="/accounts/:accountId" element={<AccountSettingsView />} />
          <Route path="/accounts/:accountId/:tab" element={<AccountSettingsView />} />
        </Routes>
      </StoreContext.Provider>
    </MemoryRouter>,
  )
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
      renderAt(`/accounts/${encodeURIComponent(principals[1]!)}`, store)

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
      renderAt(`/accounts/${encodeURIComponent(principals[0]!)}`, store)

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

  test('shows and dismisses the desktop connection success banner', async () => {
    const originalFetch = global.fetch
    global.fetch = mock(async () => new Response('{}', {status: 200})) as unknown as typeof fetch
    const {store, principals} = createVaultStore(['Alice'])
    store.state.vaultConnectionSuccessMessage =
      'Your Seed desktop app has been linked with this remote vault successfully.'

    try {
      renderAt(`/accounts/${encodeURIComponent(principals[0]!)}`, store)

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
