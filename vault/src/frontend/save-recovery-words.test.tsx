import type * as api from '@/api'
import * as base64 from '@seed-hypermedia/client/base64'
import * as rtl from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, spyOn, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import * as crypto from './crypto'
import * as navigation from './navigation'
import {createRouter} from './router'
import {StoreContext, createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'

function setWindowUrl(url: string) {
  const testWindow = window as unknown as {happyDOM: {setURL(url: string): void}}
  testWindow.happyDOM.setURL(url)
}

const dek = new Uint8Array(64).fill(9)

/** Renders the app on the recovery step for a signed-in user mid-registration. */
async function renderRecoveryStep(addSecretCredential: api.ClientInterface['addSecretCredential']) {
  const client = createMockClient({
    getSession: async () => ({
      authenticated: true,
      relyingPartyOrigin: 'http://localhost',
      userId: 'user-123',
      email: 'new@example.com',
      credentials: {password: true},
    }),
    addSecretCredential,
  })
  setWindowUrl('http://localhost/vault/recovery')
  const store = createStore(client, createMockBlockstore())
  store.state.decryptedDEK = dek
  const router = createRouter()
  store.navigator.setNavigate((path) => router.navigate(navigation.withHash(path)))

  await rtl.act(async () => {
    rtl.render(
      <StoreContext.Provider value={store}>
        <ReactRouter.RouterProvider router={router} />
      </StoreContext.Provider>,
    )
  })
  await rtl.waitFor(() => {
    expect(rtl.screen.getAllByRole('listitem')).toHaveLength(crypto.RECOVERY_WORD_COUNT)
  })
  return store
}

describe('recovery words step', () => {
  beforeEach(() => {
    sessionStorage.clear()
    spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovery-words')
    spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined)
  })

  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('shows the same 12 words after a refresh until they are saved', async () => {
    const first = await renderRecoveryStep(async () => ({success: true, credentialId: 'recovery'}))
    const words = [...first.state.recoveryWords]
    expect(crypto.isValidRecoveryPhrase(words)).toBe(true)

    rtl.cleanup()
    const second = await renderRecoveryStep(async () => ({success: true, credentialId: 'recovery'}))
    expect(second.state.recoveryWords).toEqual(words)
  })

  test('confirming saves a recovery credential the words can unlock, then moves on', async () => {
    let request: api.AddSecretCredentialRequest | undefined
    const store = await renderRecoveryStep(async (req) => {
      request = req
      return {success: true, credentialId: 'recovery'}
    })
    const words = [...store.state.recoveryWords]

    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByText("I've saved my words"))
    })
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/identity-secured')
    })

    expect(request?.purpose).toBe('recovery')
    const secret = await crypto.deriveRecoverySecret(words)
    expect(request?.authKey).toBe(base64.encode(await crypto.deriveSecretCredentialAuthKey(secret)))
    expect(await crypto.decrypt(base64.decode(request!.wrappedDEK), secret)).toEqual(dek)
    expect(sessionStorage.length).toBe(0)
  })

  test('downloading saves the words too, stays on the step, and keeps the same words', async () => {
    const requests: api.AddSecretCredentialRequest[] = []
    const store = await renderRecoveryStep(async (req) => {
      requests.push(req)
      return {success: true, credentialId: 'recovery'}
    })
    const words = [...store.state.recoveryWords]

    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByText('Download recovery document'))
    })

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    const blob = (URL.createObjectURL as unknown as {mock: {calls: [Blob][]}}).mock.calls.at(-1)![0]
    expect(crypto.parseRecoveryDocument(await blob.text())).toEqual(words)
    await rtl.waitFor(() => {
      expect(requests).toHaveLength(1)
    })
    const secret = await crypto.deriveRecoverySecret(words)
    expect(requests[0]!.authKey).toBe(base64.encode(await crypto.deriveSecretCredentialAuthKey(secret)))
    expect(store.state.session?.credentials?.recoveryWords).toBe(true)
    // Still on the step with the downloaded words, which survive a refresh until the user moves on.
    expect(window.location.pathname).toBe('/vault/recovery')
    expect(store.state.recoveryWords).toEqual(words)
    expect(sessionStorage.length).toBe(1)

    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByText("I've saved my words"))
    })
    await rtl.waitFor(() => {
      expect(window.location.pathname).toBe('/vault/identity-secured')
    })
    // Same words both times, so the second save just replaces the first with an identical one.
    expect(requests[1]!.authKey).toBe(requests[0]!.authKey)
    expect(sessionStorage.length).toBe(0)
  })

  test('copies the words as one phrase', async () => {
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const store = await renderRecoveryStep(async () => ({success: true, credentialId: 'recovery'}))

    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByRole('button', {name: 'Copy words'}))
    })

    expect(writeText).toHaveBeenCalledWith(store.state.recoveryWords.join(' '))
    rtl.screen.getByRole('button', {name: 'Copied'})
  })

  test('keeps the words and shows an error when saving fails', async () => {
    const store = await renderRecoveryStep(async () => {
      throw new Error('network down')
    })
    const words = [...store.state.recoveryWords]

    await rtl.act(async () => {
      rtl.fireEvent.click(rtl.screen.getByText("I've saved my words"))
    })
    await rtl.waitFor(() => {
      expect(
        rtl.screen.getByText("We couldn't save your recovery words. Check your connection and try again."),
      ).toBeTruthy()
    })
    expect(window.location.pathname).toBe('/vault/recovery')
    expect(store.state.recoveryWords).toEqual(words)
  })
})
