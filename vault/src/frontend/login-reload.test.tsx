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

describe('reload on /login', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('logged-out reload restarts at the pre-login screen instead of a broken page', async () => {
    setWindowUrl('http://localhost/vault/login')
    await renderApp(
      createMockClient({
        getSession: async () => ({
          authenticated: false,
          relyingPartyOrigin: window.location.origin,
        }),
      }),
    )

    // Without the in-memory flow state (email + credential flags from
    // preLogin), /login cannot render a sign-in form — the user must be
    // bounced back to the email entry screen.
    await rtl.screen.findByPlaceholderText('Enter your email')
    await rtl.waitFor(() => {
      expect(window.location.pathname).toMatch(/^\/vault\/?$/)
    })
  })
})
