import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createMockClient} from '@/frontend/test-utils'
import {CreateProfileView} from './CreateProfileView'

function renderCreateProfileView() {
  const store = createStore(createMockClient(), createMockBlockstore(), '', 'https://notify.default.example.com')
  const createAccount = mock(async () => true)

  store.state.session = {
    authenticated: true,
    relyingPartyOrigin: 'https://vault.example.com',
    email: 'test@example.com',
  }
  store.state.decryptedDEK = new Uint8Array(32)
  store.state.vaultData = {
    version: 2,
    accounts: [],
  }
  store.actions.createAccount = createAccount as typeof store.actions.createAccount

  render(
    <MemoryRouter initialEntries={['/profile/create']}>
      <StoreContext.Provider value={store}>
        <CreateProfileView />
      </StoreContext.Provider>
    </MemoryRouter>,
  )

  return {createAccount}
}

describe('CreateProfileView', () => {
  afterEach(() => {
    cleanup()
  })

  test('shares the email with the notification server by default', async () => {
    const {createAccount} = renderCreateProfileView()

    const checkbox = screen.getByLabelText('Notify me at test@example.com') as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'Alice'}})
    fireEvent.click(screen.getByRole('button', {name: 'Start participating'}))

    await waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('Alice', undefined, undefined, {
        notificationRegistration: {
          includeEmail: true,
        },
      })
    })
  })

  test('registers without an email when the checkbox is unchecked', async () => {
    const {createAccount} = renderCreateProfileView()

    fireEvent.click(screen.getByLabelText('Notify me at test@example.com'))
    fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'Alice'}})
    fireEvent.click(screen.getByRole('button', {name: 'Start participating'}))

    await waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('Alice', undefined, undefined, {
        notificationRegistration: {
          includeEmail: false,
        },
      })
    })
  })
})
