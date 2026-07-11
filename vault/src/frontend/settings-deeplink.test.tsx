import * as base64 from '@seed-hypermedia/client/base64'
import * as encryption from '@seed-hypermedia/client/encryption'
import * as rtl from '@testing-library/react'
import {afterEach, describe, expect, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import * as localCrypto from './crypto'
import * as navigation from './navigation'
import {createRouter} from './router'
import {StoreContext, createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'
import * as vault from './vault'

function setWindowUrl(url: string) {
  const testWindow = window as unknown as {happyDOM: {setURL(url: string): void}}
  testWindow.happyDOM.setURL(url)
}

/**
 * The desktop app deep-links to /vault/settings ("Manage Passkeys"). When the
 * browser session is locked or signed out, the sign-in detour must return to
 * /settings (vault-level Identity Settings) instead of landing on the root,
 * which auto-selects the first account.
 */
describe('desktop deep link to /settings', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('returns to Identity Settings after password unlock', async () => {
    const client = createMockClient({
      getSession: async () => ({
        authenticated: true,
        relyingPartyOrigin: window.location.origin,
        userId: 'user-1',
        email: 'user@example.com',
        credentials: {password: true as const},
      }),
    })
    setWindowUrl('http://localhost/vault/settings')
    const store = createStore(client, createMockBlockstore())
    const router = createRouter()
    store.navigator.setNavigate((path) => router.navigate(navigation.withHash(path)))

    await rtl.act(async () => {
      rtl.render(
        <StoreContext.Provider value={store}>
          <ReactRouter.RouterProvider router={router} />
        </StoreContext.Provider>,
      )
    })

    // Password is the only unlock option: the lock screen renders the
    // password form inline, with no detour to /login.
    await rtl.screen.findByLabelText('Password')
    expect(window.location.pathname).toBe('/vault/settings')
    rtl.screen.getByText("Signed in as user@example.com. Verify it's you to continue.")
    expect(rtl.screen.queryByText('or')).toBeNull()
    expect(rtl.screen.queryByText('Use passkey')).toBeNull()
    expect(rtl.screen.queryByText('🔑 Sign in with Passkey')).toBeNull()

    // Simulate a successful password unlock (the crypto path is covered by the
    // store tests); the settings route must stay put.
    await rtl.act(async () => {
      store.state.decryptedDEK = new Uint8Array(32)
      const lockedVaultState = vault.createEmpty()
      lockedVaultState.accounts.push({seed: new Uint8Array(32), createTime: 1, delegations: []})
      store.state.vaultData = lockedVaultState
      store.state.vaultLoaded = true
    })

    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/settings')
    })

    // Let any queued redirects (e.g. the first-account fallback) flush, then
    // confirm we are still on the vault-level Identity Settings.
    await rtl.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(window.location.pathname).toBe('/vault/settings')
  })

  test('signed-out deep link returns to Identity Settings after full email + password sign-in', async () => {
    // Build a real vault fixture so the production handleLogin path (argon2 →
    // unwrap DEK → decrypt vault) runs end to end.
    const password = 'correct horse battery staple'
    const salt = base64.encode(new Uint8Array(16).fill(7))
    const rootKey = await encryption.deriveKeyFromPassword(password, base64.decode(salt))
    const encryptionKey = await localCrypto.deriveEncryptionKey(rootKey)
    const dek = new Uint8Array(32).fill(5)
    const wrappedDEK = base64.encode(await localCrypto.encrypt(dek, encryptionKey))
    const vaultState = vault.createEmpty()
    vaultState.accounts.push({seed: new Uint8Array(32).fill(3), createTime: 1, delegations: []})
    const encryptedData = base64.encode(await localCrypto.encrypt(await vault.serialize(vaultState), dek))

    let authed = false
    const client = createMockClient({
      getSession: async () =>
        authed
          ? {
              authenticated: true,
              relyingPartyOrigin: window.location.origin,
              userId: 'user-1',
              email: 'user@example.com',
              credentials: {password: true as const},
            }
          : {authenticated: false, relyingPartyOrigin: window.location.origin},
      preLogin: async () => ({exists: true, salt, credentials: {password: true}}),
      login: async () => {
        authed = true
        return {success: true, userId: 'user-1'}
      },
      getVault: async () => ({
        version: 1,
        encryptedData,
        credentials: [{kind: 'password' as const, salt, wrappedDEK}],
      }),
    })

    setWindowUrl('http://localhost/vault/settings')
    const store = createStore(client, createMockBlockstore())
    const router = createRouter()
    store.navigator.setNavigate((path) => router.navigate(navigation.withHash(path)))

    await rtl.act(async () => {
      rtl.render(
        <StoreContext.Provider value={store}>
          <ReactRouter.RouterProvider router={router} />
        </StoreContext.Provider>,
      )
    })

    // Signed out: bounced to the pre-login screen.
    const emailInput = await rtl.screen.findByPlaceholderText('you@example.com')
    expect(store.state.returnToPath).toBe('/settings')
    await rtl.act(async () => {
      rtl.fireEvent.change(emailInput, {target: {value: 'user@example.com'}})
    })
    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByRole('button', {name: 'Continue'}))
    })

    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/login')
    })

    const passwordInput = await rtl.screen.findByLabelText('Password')
    await rtl.act(async () => {
      rtl.fireEvent.change(passwordInput, {target: {value: password}})
    })
    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByRole('button', {name: 'Sign in'}))
    })

    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/settings')
    })

    // Confirm it sticks — no late bounce to a single account's settings.
    await rtl.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(window.location.pathname).toBe('/vault/settings')
  })
})
