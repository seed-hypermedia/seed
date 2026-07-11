import * as base64 from '@seed-hypermedia/client/base64'
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

describe('connect success routing repro', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('lands on /connect/success after confirming the desktop connection', async () => {
    const connectToken = base64.encode(new Uint8Array(32).fill(7))
    const client = createMockClient({
      getSession: async () => ({
        authenticated: true,
        relyingPartyOrigin: 'http://localhost',
        userId: 'user-123',
        email: 'repro@example.com',
        credentials: {password: true},
      }),
      addSecretCredential: async () => ({success: true, credentialId: 'secret-credential'}),
      putVaultConnect: async () => ({success: true, expireTime: Date.now() + 120_000}),
    })

    setWindowUrl(`http://localhost/vault/connect#token=${encodeURIComponent(connectToken)}`)
    const store = createStore(client, createMockBlockstore())
    store.state.decryptedDEK = new Uint8Array(64).fill(9)
    const router = createRouter()
    store.navigator.setNavigate((path) => router.navigate(navigation.withHash(path)))

    await rtl.act(async () => {
      rtl.render(
        <StoreContext.Provider value={store}>
          <ReactRouter.RouterProvider router={router} />
        </StoreContext.Provider>,
      )
    })

    // The consent screen should be visible.
    await rtl.waitFor(() => {
      expect(rtl.screen.getByText('Connect desktop')).toBeTruthy()
    })

    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByText('Connect desktop'))
    })

    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/connect/success')
    })
    expect(rtl.screen.getByText('Open Seed')).toBeTruthy()
    expect(rtl.screen.getByText('account settings.')).toBeTruthy()

    // The redirect race would bounce to "/" a beat later; make sure we stay.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(window.location.pathname).toBe('/vault/connect/success')
  })
})
