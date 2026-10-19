import * as base64 from '@seed-hypermedia/client/base64'
import * as rtl from '@testing-library/react'
import {afterEach, describe, expect, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import {APIError} from './api-client'
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

/** The BIP-39 test vector phrase: valid checksum, so only the server can reject it. */
const recoveryWords = [...Array(11).fill('abandon'), 'about']

/**
 * Renders the app signed out, enters the email of an existing password user, and waits on the
 * sign-in options screen. With `lockedAt`, the user is instead signed in but locked on that path.
 * Recovery login unlocks a real vault encrypted for `recoveryWords`.
 */
async function renderSignIn({lockedAt}: {lockedAt?: string} = {}) {
  const dek = new Uint8Array(32).fill(5)
  const secret = await localCrypto.deriveRecoverySecret(recoveryWords)
  const recoveryAuthKey = base64.encode(await localCrypto.deriveSecretCredentialAuthKey(secret))
  const vaultState = vault.createEmpty()
  vaultState.accounts.push({seed: new Uint8Array(32).fill(3), createTime: 1, delegations: []})
  const encryptedData = base64.encode(await localCrypto.encrypt(await vault.serialize(vaultState), dek))
  const wrappedDEK = base64.encode(await localCrypto.encrypt(dek, secret))

  let authed = !!lockedAt
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
    preLogin: async () => ({exists: true, salt: base64.encode(new Uint8Array(16)), credentials: {password: true}}),
    login: async () => {
      throw new APIError('Invalid credentials', 401)
    },
    loginRecovery: async (req) => {
      if (req.authKey !== recoveryAuthKey) throw new APIError('Invalid credentials', 401)
      authed = true
      return {success: true, userId: 'user-1', credentialId: 'recovery-credential'}
    },
    getVault: async () => ({
      version: 1,
      encryptedData,
      credentials: [{kind: 'secret' as const, credentialId: 'recovery-credential', wrappedDEK}],
    }),
  })

  setWindowUrl(`http://localhost/vault${lockedAt ?? '/'}`)
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
  if (lockedAt) {
    await rtl.screen.findByText('Unlock your vault')
    return store
  }

  const emailInput = await rtl.screen.findByPlaceholderText('Enter your email')
  await rtl.act(async () => {
    rtl.fireEvent.change(emailInput, {target: {value: 'user@example.com'}})
  })
  await rtl.act(async () => {
    rtl.fireEvent.click(rtl.screen.getByRole('button', {name: 'Send code'}))
  })
  await rtl.waitFor(() => {
    expect(window.location.pathname).toBe('/vault/login')
  })
  return store
}

async function click(element: HTMLElement) {
  await rtl.act(async () => {
    rtl.fireEvent.click(element)
  })
}

/** Goes from the options screen to the recovery words form. */
async function openRecoveryForm() {
  await click(await rtl.screen.findByText('Sign in with password'))
  await click(await rtl.screen.findByRole('button', {name: 'Forgot password?'}))
  await rtl.waitFor(() => {
    expect(window.location.pathname).toBe('/vault/login/recover')
  })
}

/** Pastes the whole phrase into the first field, which spreads it over all of them. */
async function pasteWords(words: string[]) {
  await rtl.act(async () => {
    rtl.fireEvent.change(rtl.screen.getByLabelText('Recovery word 1'), {target: {value: ` ${words.join('  ')} `}})
  })
}

describe('sign in with password', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('options screen offers only the credentials the user has', async () => {
    await renderSignIn()

    rtl.screen.getByText('Good to see you again', {exact: false})
    rtl.screen.getByText('Signing in as user@example.com', {exact: false})
    rtl.screen.getByText('Sign in with password')
    expect(rtl.screen.queryByText('Sign in with passkey')).toBeNull()
  })

  test('wrong password shows an inline error and blocks Continue until the password changes', async () => {
    await renderSignIn()
    await click(await rtl.screen.findByText('Sign in with password'))

    const passwordInput = await rtl.screen.findByLabelText('Password')
    await rtl.act(async () => {
      rtl.fireEvent.change(passwordInput, {target: {value: 'wrong password'}})
    })
    await click(rtl.screen.getByRole('button', {name: 'Continue'}))

    await rtl.screen.findByText('Incorrect password, please try again.')
    expect(passwordInput.getAttribute('aria-invalid')).toBe('true')
    expect((rtl.screen.getByRole('button', {name: 'Continue'}) as HTMLButtonElement).disabled).toBe(true)

    await rtl.act(async () => {
      rtl.fireEvent.change(passwordInput, {target: {value: 'another try'}})
    })
    expect(rtl.screen.queryByText('Incorrect password, please try again.')).toBeNull()
    expect((rtl.screen.getByRole('button', {name: 'Continue'}) as HTMLButtonElement).disabled).toBe(false)
  })

  test('recovery words unlock the vault and lead to the account picker', async () => {
    await renderSignIn()
    await openRecoveryForm()

    expect((rtl.screen.getByRole('button', {name: 'Continue'}) as HTMLButtonElement).disabled).toBe(true)
    await pasteWords(recoveryWords)
    recoveryWords.forEach((word, i) => {
      expect((rtl.screen.getByLabelText(`Recovery word ${i + 1}`) as HTMLInputElement).value).toBe(word)
    })
    await click(rtl.screen.getByRole('button', {name: 'Continue'}))

    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/login/recovered')
    })
    await rtl.screen.findByText('Your identity is recovered.', {exact: false})
    // A single account needs no picker.
    expect(rtl.screen.queryByText(/Which account would you like to use/)).toBeNull()

    await click(await rtl.screen.findByRole('button', {name: /^Continue/}))
    await rtl.waitFor(() => {
      expect(window.location.pathname).not.toBe('/vault/login/recovered')
    })
  })

  test('uploading the recovery document fills the words, and other files are rejected', async () => {
    await renderSignIn()
    await openRecoveryForm()
    const fileInput = rtl.screen.getByLabelText('Recovery document')

    await rtl.act(async () => {
      rtl.fireEvent.change(fileInput, {target: {files: [new File(['my notes'], 'notes.txt', {type: 'text/plain'})]}})
    })
    await rtl.screen.findByText(
      "This file isn't a Hypermedia recovery document. Choose the file you downloaded at sign-up.",
    )

    const document = localCrypto.formatRecoveryDocument(recoveryWords, 'user@example.com')
    await rtl.act(async () => {
      rtl.fireEvent.change(fileInput, {
        target: {files: [new File([document], 'hypermedia-recovery-words.txt', {type: 'text/plain'})]},
      })
    })
    await rtl.waitFor(() => {
      expect((rtl.screen.getByLabelText('Recovery word 12') as HTMLInputElement).value).toBe('about')
    })
    expect(rtl.screen.queryByText("This file isn't a Hypermedia recovery document.", {exact: false})).toBeNull()

    await click(rtl.screen.getByRole('button', {name: 'Continue'}))
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/login/recovered')
    })
  })

  test('words that do not match the account show an error, with a way out for users without words', async () => {
    await renderSignIn()
    await openRecoveryForm()

    await pasteWords([...Array(11).fill('zoo'), 'wrong'])
    await click(rtl.screen.getByRole('button', {name: 'Continue'}))
    await rtl.screen.findByText("These recovery words don't match this account. Check each word and their order.")
    expect(window.location.pathname).toBe('/vault/login/recover')

    await click(rtl.screen.getByRole('button', {name: "Don't have recovery words?"}))
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/login/no-recovery')
    })
    rtl.screen.getByText('Create a new account')
    expect(rtl.screen.queryByText('Sign in with passkey')).toBeNull()
  })

  test('Use another email clears what was typed for the previous email', async () => {
    await renderSignIn()
    await click(await rtl.screen.findByText('Sign in with password'))
    await rtl.act(async () => {
      rtl.fireEvent.change(await rtl.screen.findByLabelText('Password'), {target: {value: 'typed for the first email'}})
    })
    await click(rtl.screen.getByRole('button', {name: '← Back'}))
    await click(await rtl.screen.findByRole('button', {name: '← Use another email'}))

    const emailInput = await rtl.screen.findByPlaceholderText('Enter your email')
    expect((emailInput as HTMLInputElement).value).toBe('')
    await rtl.act(async () => {
      rtl.fireEvent.change(emailInput, {target: {value: 'other@example.com'}})
    })
    await click(rtl.screen.getByRole('button', {name: 'Send code'}))
    await click(await rtl.screen.findByText('Sign in with password'))
    expect(((await rtl.screen.findByLabelText('Password')) as HTMLInputElement).value).toBe('')
  })

  test('the word fields can be filled and traversed with the keyboard', async () => {
    await renderSignIn()
    await openRecoveryForm()
    const field = (n: number) => rtl.screen.getByLabelText(`Recovery word ${n}`) as HTMLInputElement
    const key = (n: number, keyName: string) =>
      rtl.act(async () => {
        rtl.fireEvent.keyDown(field(n), {key: keyName})
      })

    field(1).focus()
    await rtl.act(async () => {
      rtl.fireEvent.change(field(1), {target: {value: 'abandon '}})
    })
    expect(field(1).value).toBe('abandon')
    expect(document.activeElement).toBe(field(2))

    await key(2, 'ArrowLeft')
    expect(document.activeElement).toBe(field(1))
    await key(1, 'ArrowRight')
    expect(document.activeElement).toBe(field(2))
    await key(2, 'ArrowDown')
    expect(document.activeElement).toBe(field(5))
    await key(5, 'ArrowUp')
    expect(document.activeElement).toBe(field(2))
    await key(2, 'Backspace')
    expect(document.activeElement).toBe(field(1))
    // No field above the first row: focus stays.
    await key(1, 'ArrowUp')
    expect(document.activeElement).toBe(field(1))
  })

  test('the lock screen offers recovery and returns to where the user was', async () => {
    await renderSignIn({lockedAt: '/settings'})

    await click(rtl.screen.getByRole('button', {name: 'Forgot password?'}))
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/login/recover')
    })
    await pasteWords(recoveryWords)
    await click(rtl.screen.getByRole('button', {name: 'Continue'}))

    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/login/recovered')
    })
    await click(await rtl.screen.findByRole('button', {name: /^Continue/}))
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/settings')
    })
  })
})
