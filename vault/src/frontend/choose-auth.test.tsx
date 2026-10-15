import type * as api from '@/api'
import * as rtl from '@testing-library/react'
import {afterEach, describe, expect, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import * as navigation from './navigation'
import {createRouter} from './router'
import {StoreContext, createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'
import * as vault from './vault'

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

async function renderApp(client: ReturnType<typeof createMockClient>) {
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
  return store
}

/** The clickable option card that contains the given title. */
function optionButton(title: string) {
  const button = rtl.screen.getByText(title).closest('button')
  if (!button) throw new Error(`No option button for "${title}"`)
  return button
}

describe('choose auth options', () => {
  afterEach(() => {
    rtl.cleanup()
    delete (window as {PublicKeyCredential?: unknown}).PublicKeyCredential
    setWindowUrl('http://localhost/')
  })

  test('disables the passkey option with guidance when passkeys are unsupported', async () => {
    setWindowUrl('http://localhost/vault/auth/choose')
    await renderApp(createMockClient({getSession: registrationSession}))

    await rtl.waitFor(() => {
      expect(rtl.screen.getByText('Use a password')).toBeTruthy()
    })
    expect(optionButton('Use a passkey').disabled).toBe(true)
    expect(rtl.screen.getByText('Your device does not support Passkey, please add password instead.')).toBeTruthy()
    expect(rtl.screen.queryByText('Recommended')).toBeNull()
    expect(optionButton('Use a password').disabled).toBe(false)
  })

  test('offers both options up front and falls back to password after a failed passkey', async () => {
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

    // Both options are available immediately, with passkey recommended.
    await rtl.waitFor(() => {
      expect(rtl.screen.getByText('Use a passkey')).toBeTruthy()
    })
    expect(rtl.screen.getByText('Recommended')).toBeTruthy()
    expect(optionButton('Use a passkey').disabled).toBe(false)
    expect(optionButton('Use a password').disabled).toBe(false)

    // A failed passkey attempt surfaces the error.
    await rtl.act(async () => {
      rtl.fireEvent.click(optionButton('Use a passkey'))
    })
    await rtl.waitFor(() => {
      expect(rtl.screen.getByText("Passkey wasn't created. You can try again or use a password instead.")).toBeTruthy()
    })

    // Choosing the password path lands on the set-password form with the error cleared.
    await rtl.act(async () => {
      rtl.fireEvent.click(optionButton('Use a password'))
    })
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/password/set')
    })
    expect(rtl.screen.getByText('Create a password')).toBeTruthy()
    expect(rtl.screen.queryByText("Passkey wasn't created. You can try again or use a password instead.")).toBeNull()
    expect(rtl.screen.getByText('At least 8 characters')).toBeTruthy()
    expect(rtl.screen.getByText('← Back')).toBeTruthy()
  })
})

describe('leaving sign-up early', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('X signs out to the email screen', async () => {
    let loggedOut = false
    setWindowUrl('http://localhost/vault/auth/choose')
    await renderApp(
      createMockClient({
        getSession: async () =>
          loggedOut ? {authenticated: false, relyingPartyOrigin: 'http://localhost'} : registrationSession(),
        logout: async () => {
          loggedOut = true
          return {success: true}
        },
      }),
    )

    await rtl.screen.findByText('Use a password')
    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByRole('button', {name: 'Close'}))
    })

    expect(loggedOut).toBe(true)
    await rtl.screen.findByPlaceholderText('Enter your email')
  })

  test('after the password is set, X goes to the vault and keeps the user signed in', async () => {
    let loggedOut = false
    setWindowUrl('http://localhost/vault/recovery')
    const store = createStore(
      createMockClient({
        getSession: async () => ({...(await registrationSession()), credentials: {password: true as const}}),
        logout: async () => {
          loggedOut = true
          return {success: true}
        },
      }),
      createMockBlockstore(),
    )
    store.state.decryptedDEK = new Uint8Array(32)
    store.state.vaultData = vault.createEmpty()
    store.state.vaultLoaded = true
    const router = createRouter()
    store.navigator.setNavigate((path) => router.navigate(navigation.withHash(path)))
    await rtl.act(async () => {
      rtl.render(
        <StoreContext.Provider value={store}>
          <ReactRouter.RouterProvider router={router} />
        </StoreContext.Provider>,
      )
    })

    await rtl.screen.findByText('Save your recovery words')
    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByRole('button', {name: 'Close'}))
    })

    await rtl.screen.findByRole('button', {name: 'Save recovery words'})
    expect(loggedOut).toBe(false)
    // Signing in later must not drop the user back into the sign-up step.
    expect(store.state.returnToPath).not.toBe('/recovery')
  })

  /** Unlocks a vault with no account yet, for a user with the given credentials. */
  async function unlockWithoutAccounts(
    credentials: {password?: true; recoveryWords?: true},
    overrides: Partial<api.ClientInterface> = {},
  ) {
    setWindowUrl('http://localhost/vault/')
    const store = await renderApp(
      createMockClient({
        getSession: async () => ({...(await registrationSession()), credentials}),
        ...overrides,
      }),
    )
    await rtl.screen.findByText('Unlock your vault')
    await rtl.act(async () => {
      store.state.decryptedDEK = new Uint8Array(32)
      store.state.vaultData = vault.createEmpty()
      store.state.vaultLoaded = true
    })
    return store
  }

  test('a vault without accounts is not treated as an unfinished sign-up', async () => {
    await unlockWithoutAccounts({password: true, recoveryWords: true})

    await rtl.screen.findAllByText('Identity Settings')
    expect(window.location.pathname).toBe('/vault/settings')
    expect(rtl.screen.queryByText('Save your recovery words')).toBeNull()
  })

  test('a password user without recovery words is reminded until they save them', async () => {
    let request: api.AddSecretCredentialRequest | undefined
    await unlockWithoutAccounts(
      {password: true},
      {
        addSecretCredential: async (req) => {
          request = req
          return {success: true, credentialId: 'recovery'}
        },
      },
    )

    await rtl.act(async () => {
      rtl.fireEvent.click(await rtl.screen.findByRole('button', {name: 'Save recovery words'}))
    })
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/settings/recovery-words')
    })
    await rtl.waitFor(() => {
      expect(rtl.screen.getAllByRole('listitem')).toHaveLength(12)
    })
    rtl.screen.getByRole('button', {name: 'Close'})

    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByRole('button', {name: "I've saved my words"}))
    })
    await rtl.screen.findAllByText('Identity Settings')
    expect(request?.purpose).toBe('recovery')
    expect(rtl.screen.queryByRole('button', {name: 'Save recovery words'})).toBeNull()
  })
})
