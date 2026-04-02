import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createMockClient} from '@/frontend/test-utils'
import {CreateAccountDialog} from './CreateAccountDialog'

function renderCreateAccountDialog() {
  const store = createStore(createMockClient(), createMockBlockstore(), '', 'https://notify.default.example.com')
  const createAccount = mock(async () => true)

  store.state.creatingAccount = true
  store.state.session = {
    authenticated: true,
    relyingPartyOrigin: 'https://vault.example.com',
    email: 'test@example.com',
  }
  store.actions.createAccount = createAccount as typeof store.actions.createAccount

  render(
    <StoreContext.Provider value={store}>
      <CreateAccountDialog />
    </StoreContext.Provider>,
  )

  return {createAccount}
}

describe('CreateAccountDialog', () => {
  afterEach(() => {
    cleanup()
  })

  test('shares the email with the notification server by default', async () => {
    const {createAccount} = renderCreateAccountDialog()

    const checkbox = screen.getByLabelText('Notify me at test@example.com') as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'Alice'}})
    fireEvent.click(screen.getByRole('button', {name: 'Create Account'}))

    await waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('Alice', undefined, undefined, {
        notificationRegistration: {
          includeEmail: true,
        },
      })
    })
  })

  test('registers without an email when the checkbox is unchecked', async () => {
    const {createAccount} = renderCreateAccountDialog()

    fireEvent.click(screen.getByLabelText('Notify me at test@example.com'))
    fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'Alice'}})
    fireEvent.click(screen.getByRole('button', {name: 'Create Account'}))

    await waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('Alice', undefined, undefined, {
        notificationRegistration: {
          includeEmail: false,
        },
      })
    })
  })
})
