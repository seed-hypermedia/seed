import * as base64 from '@seed-hypermedia/client/base64'
import * as blobs from '@shm/shared/blobs'
import * as hmauth from '@shm/shared/hmauth'
import * as rtl from '@testing-library/react'
import {afterEach, expect, spyOn, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import {createRouter} from './router'
import {createStore, StoreContext} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'

async function signedRequest() {
  const key = blobs.generateNobleKeyPair()
  const url = new URL('http://localhost/vault/delegate')
  url.search = new URLSearchParams({
    client_id: url.origin,
    redirect_uri: `${url.origin}/hm/auth/callback`,
    session_key: blobs.principalToString(key.principal),
    state: base64.encode(new Uint8Array(16)),
    ts: String(Date.now()),
  }).toString()
  url.searchParams.set('proof', base64.encode(await key.sign(new TextEncoder().encode(url.toString()))))
  return url.toString()
}
function newStore() {
  return createStore(createMockClient(), createMockBlockstore())
}
function setUrl(url: string) {
  ;(window as unknown as {happyDOM: {setURL(url: string): void}}).happyDOM.setURL(url)
}
afterEach(() => {
  rtl.cleanup()
  setUrl('http://localhost/')
})

test('password-page reload retains the exact signed site request', async () => {
  const original = await signedRequest()
  newStore().actions.parseDelegationFromUrl(original)
  const reloaded = newStore()
  reloaded.actions.parseDelegationFromUrl('http://localhost/vault/login/password')
  expect(reloaded.state.delegationRequest?.originalUrl).toBe(original)
  await hmauth.verifyDelegationRequestProof(reloaded.state.delegationRequest!, 'http://localhost')
})
test('explicit settings do not resume an unrelated site login', async () => {
  newStore().actions.parseDelegationFromUrl(await signedRequest())
  const settings = newStore()
  settings.actions.parseDelegationFromUrl('http://localhost/vault/settings')
  expect(settings.state.delegationRequest).toBeNull()
})
test('a new request replaces the pending request and cancel consumes it', async () => {
  const first = newStore()
  first.actions.parseDelegationFromUrl(await signedRequest())
  const second = await signedRequest()
  first.actions.parseDelegationFromUrl(second)
  const reloaded = newStore()
  reloaded.actions.parseDelegationFromUrl('http://localhost/vault/login')
  expect(reloaded.state.delegationRequest?.originalUrl).toBe(second)
  reloaded.actions.cancelDelegation()
  const afterCancel = newStore()
  afterCancel.actions.parseDelegationFromUrl('http://localhost/vault/login')
  expect(afterCancel.state.delegationRequest).toBeNull()
})
test('invalid URL parameters cannot fall back to a previous request', async () => {
  newStore().actions.parseDelegationFromUrl(await signedRequest())
  const invalid = newStore()
  invalid.actions.parseDelegationFromUrl('http://localhost/vault/delegate?client_id=bad')
  expect(invalid.state.delegationRequest).toBeNull()
  expect(invalid.state.error).not.toBe('')
  const reloaded = newStore()
  reloaded.actions.parseDelegationFromUrl('http://localhost/vault/login')
  expect(reloaded.state.delegationRequest).toBeNull()
})
test('restored requests still require a valid signature', async () => {
  const original = new URL(await signedRequest())
  original.searchParams.set('proof', base64.encode(new Uint8Array(64)))
  newStore().actions.parseDelegationFromUrl(original)
  const reloaded = newStore()
  reloaded.actions.parseDelegationFromUrl('http://localhost/vault/login')
  await expect(
    hmauth.verifyDelegationRequestProof(reloaded.state.delegationRequest!, 'http://localhost'),
  ).rejects.toThrow()
})
test('enterprise root starts site login; public vault retains its entry UI', async () => {
  const replace = spyOn(window.location, 'replace').mockImplementation(() => {})
  try {
    for (const enterprise of [true, false]) {
      setUrl('http://localhost/vault')
      const store = createStore(
        createMockClient({getSession: async () => ({authenticated: false, relyingPartyOrigin: 'http://localhost'})}),
        createMockBlockstore(),
        '',
        '',
        '',
        enterprise,
      )
      const router = createRouter()
      await rtl.act(async () => {
        rtl.render(
          <StoreContext.Provider value={store}>
            <ReactRouter.RouterProvider router={router} />
          </StoreContext.Provider>,
        )
      })
      if (enterprise) {
        await rtl.waitFor(() => expect(replace).toHaveBeenCalledWith('http://localhost/hm/sign-in?next=%2Fvault'))
        window.sessionStorage.clear()
      } else {
        expect(rtl.screen.getByText("What's your email?")).toBeDefined()
        expect(rtl.screen.getByText("We'll send a verification code.")).toBeDefined()
        expect(rtl.screen.getByRole('button', {name: 'Send code'})).toBeDefined()
        expect(rtl.screen.queryByRole('button', {name: 'Create account'})).toBeNull()
      }
      rtl.cleanup()
      router.dispose()
    }
  } finally {
    replace.mockRestore()
  }
})

test('restored requests remain subject to expiry and origin checks', async () => {
  newStore().actions.parseDelegationFromUrl(await signedRequest())
  const reloaded = newStore()
  reloaded.actions.parseDelegationFromUrl('http://localhost/vault/login')
  await expect(
    hmauth.verifyDelegationRequestProof(
      reloaded.state.delegationRequest!,
      'http://localhost',
      Date.now() + 25 * 60 * 60 * 1000,
    ),
  ).rejects.toThrow('expired')
  const otherOrigin = newStore()
  otherOrigin.actions.parseDelegationFromUrl('https://other.example/vault/login')
  expect(otherOrigin.state.delegationRequest).toBeNull()
  expect(otherOrigin.state.error).toContain('origin mismatch')
})

test('unavailable browser storage does not prevent an in-memory sign-in', async () => {
  const original = await signedRequest()
  const write = spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  try {
    const store = newStore()
    store.actions.parseDelegationFromUrl(original)
    expect(store.state.delegationRequest?.originalUrl).toBe(original)
    expect(store.state.error).toBe('')
  } finally {
    write.mockRestore()
  }
})
