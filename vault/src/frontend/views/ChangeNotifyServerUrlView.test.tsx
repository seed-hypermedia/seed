import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, test} from 'bun:test'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createMockClient} from '@/frontend/test-utils'
import {ChangeNotifyServerUrlView} from './ChangeNotifyServerUrlView'

function renderChangeNotifyServerUrlView(savedNotificationServerUrl?: string) {
  const client = createMockClient({
    saveVault: async () => ({success: true}),
  })
  const store = createStore(client, createMockBlockstore(), '', 'https://notify.default.example.com')

  store.state.session = {
    authenticated: true,
    relyingPartyOrigin: 'https://vault.example.com',
    email: 'test@example.com',
    credentials: {
      password: true,
    },
  }
  store.state.decryptedDEK = new Uint8Array(32)
  store.state.vaultData = {
    version: 2,
    ...(savedNotificationServerUrl ? {notificationServerUrl: savedNotificationServerUrl} : {}),
    accounts: [],
  }

  render(
    <MemoryRouter>
      <StoreContext.Provider value={store}>
        <ChangeNotifyServerUrlView />
      </StoreContext.Provider>
    </MemoryRouter>,
  )

  return {store}
}

describe('ChangeNotifyServerUrlView', () => {
  afterEach(() => {
    cleanup()
  })

  test('shows the current and default notification server URLs', () => {
    renderChangeNotifyServerUrlView()

    expect(screen.getByText('Change Notify Server URL')).toBeDefined()
    expect(screen.getByText(/Current URL:/)).toBeDefined()
    expect(screen.getAllByText('https://notify.default.example.com')).toHaveLength(2)
  })

  test('saves a notification server URL override', async () => {
    const {store} = renderChangeNotifyServerUrlView()
    const input = screen.getByLabelText('Notify Server URL') as HTMLInputElement

    fireEvent.change(input, {target: {value: 'https://notify.custom.example.com/api'}})
    fireEvent.click(screen.getByRole('button', {name: 'Save Notify Server URL'}))

    await waitFor(() => {
      expect(store.state.vaultData?.notificationServerUrl).toBe('https://notify.custom.example.com/api')
    })
  })
})
