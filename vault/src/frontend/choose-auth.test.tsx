import * as rtl from '@testing-library/react'
import {afterEach, describe, expect, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import * as navigation from './navigation'
import {createRouter} from './router'
import {StoreContext, createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'

function setWindowUrl(url: string) {
  const testWindow = window as unknown as {happyDOM: {setURL(url: string): void}}
  testWindow.happyDOM.setURL(url)
}

/** Session for a user mid-registration: verified email, no credentials yet. */
const registrationSession = async () => ({
  authenticated: true,
  relyingPartyOrigin: 'http://localhost',
  userId: 'user-123',
  email: 'new@example.com',
  credentials: {},
})

function renderApp(client: ReturnType<typeof createMockClient>) {
  const store = createStore(client, createMockBlockstore())
  const router = createRouter()
  store.navigator.setNavigate((path) => router.navigate(navigation.withHash(path)))

  return rtl.act(async () => {
    rtl.render(
      <StoreContext.Provider value={store}>
        <ReactRouter.RouterProvider router={router} />
      </StoreContext.Provider>,
    )
  })
}

describe('choose auth password fallback', () => {
  afterEach(() => {
    rtl.cleanup()
    delete (window as {PublicKeyCredential?: unknown}).PublicKeyCredential
    setWindowUrl('http://localhost/')
  })

  test('offers the password option directly when passkeys are unsupported', async () => {
    setWindowUrl('http://localhost/vault/auth/choose')
    await renderApp(createMockClient({getSession: registrationSession}))

    await rtl.waitFor(() => {
      expect(rtl.screen.getByText('Use a password')).toBeTruthy()
    })
    expect(rtl.screen.queryByText('Use passkey')).toBeNull()
  })

  test('reveals the password option after a failed passkey attempt', async () => {
    ;(window as {PublicKeyCredential?: unknown}).PublicKeyCredential = class {}
    setWindowUrl('http://localhost/vault/auth/choose')
    await renderApp(
      createMockClient({
        getSession: registrationSession,
        addPasskeyStart: async () => {
          throw new Error('User cancelled the ceremony')
        },
      }),
    )

    // Passkey-only at first.
    await rtl.waitFor(() => {
      expect(rtl.screen.getByText('Use passkey')).toBeTruthy()
    })
    expect(rtl.screen.queryByText('Use a password')).toBeNull()

    // A failed passkey attempt reveals the password fallback.
    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByText('Use passkey'))
    })
    await rtl.waitFor(() => {
      expect(rtl.screen.getByText("Passkey wasn't created. You can try again or use a password instead.")).toBeTruthy()
    })

    // Choosing the password path lands on the set-password form with the error cleared.
    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByText('Use a password'))
    })
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/password/set')
    })
    expect(rtl.screen.getByText('Set Master Password')).toBeTruthy()
    expect(rtl.screen.queryByText("Passkey wasn't created. You can try again or use a password instead.")).toBeNull()
    expect(rtl.screen.getByText('← Use a passkey instead')).toBeTruthy()
  })
})
