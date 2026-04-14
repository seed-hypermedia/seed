import {cleanup, render, screen, within} from '@testing-library/react'
import {afterEach, describe, expect, test} from 'bun:test'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createMockClient} from '@/frontend/test-utils'
import {SettingsView} from './SettingsView'

function renderSettingsView(savedNotificationServerUrl?: string) {
  const store = createStore(createMockClient(), createMockBlockstore(), '', 'https://notify.default.example.com')

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
        <SettingsView />
      </StoreContext.Provider>
    </MemoryRouter>,
  )
}

describe('SettingsView', () => {
  afterEach(() => {
    cleanup()
  })

  test('shows the effective notification server URL as a settings row without the edit form', () => {
    renderSettingsView('https://notify.custom.example.com/api')

    const notifyLabel = screen.getByText('Notify Server URL')
    expect(notifyLabel).toBeDefined()
    expect(screen.getByText('https://notify.custom.example.com/api')).toBeDefined()
    const notificationsSection = screen.getByText('NOTIFICATIONS').parentElement as HTMLElement
    expect(within(notificationsSection).getByRole('button', {name: 'Change'})).toBeDefined()
    expect(screen.queryByLabelText('Notify Server URL')).toBeNull()
  })
})
