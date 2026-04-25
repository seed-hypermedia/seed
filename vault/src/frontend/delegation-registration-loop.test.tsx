import * as base64 from '@shm/shared/base64'
import * as blobs from '@shm/shared/blobs'
import * as rtl from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import * as navigation from './navigation'
import {createRouter} from './router'
import {StoreContext, createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'
import {PreLoginView} from './views/PreLoginView'

function setWindowUrl(url: string) {
  const testWindow = window as unknown as {happyDOM: {setURL(url: string): void}}
  testWindow.happyDOM.setURL(url)
}

function makeDelegationUrl(email: string) {
  const sessionKey = blobs.generateNobleKeyPair()
  const vaultOrigin = 'http://localhost'
  const url = new URL('/vault/delegate', vaultOrigin)
  url.searchParams.set('client_id', vaultOrigin)
  url.searchParams.set('redirect_uri', `${vaultOrigin}/callback`)
  url.searchParams.set('session_key', blobs.principalToString(sessionKey.principal))
  url.searchParams.set('state', base64.encode(new Uint8Array(16)))
  url.searchParams.set('ts', String(Date.now()))
  url.searchParams.set('email', email)
  url.searchParams.set('proof', 'test-proof')
  return url
}

describe('delegation registration loop', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('does not restart registration when pending verification fails back into the delegation flow', async () => {
    const registerStart = mock(async () => ({
      message: 'ok',
      challengeId: `challenge-${registerStart.mock.calls.length}`,
    }))
    let pollCalls = 0
    const registerPoll = mock(async () => {
      pollCalls++
      if (pollCalls === 1) {
        throw new Error('expired')
      }
      return {verified: true}
    })
    let sessionCalls = 0
    const client = createMockClient({
      getSession: async () => {
        sessionCalls++
        if (sessionCalls === 1) {
          return {
            authenticated: false,
            relyingPartyOrigin: window.location.origin,
          }
        }
        return {
          authenticated: true,
          relyingPartyOrigin: window.location.origin,
          userId: 'user-1',
          email: 'loop@example.com',
          credentials: {password: true},
        }
      },
      preLogin: async () => ({exists: false}),
      registerStart,
      registerPoll,
    })
    const delegationUrl = makeDelegationUrl('loop@example.com')
    setWindowUrl('http://localhost/')
    window.history.pushState({}, '', delegationUrl.toString())
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

    await rtl.act(async () => {
      await rtl.waitFor(() => {
        expect(rtl.screen.getByText('Verification failed or expired. Please try again.')).toBeDefined()
      })
    })

    expect(registerStart).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/vault/verify/pending')
  })

  test('auto-submits matching delegation email once across rerenders', async () => {
    const registerStart = mock(async () => ({
      message: 'ok',
      challengeId: 'challenge-1',
    }))
    const store = createStore(
      createMockClient({
        preLogin: async () => ({exists: false}),
        registerStart,
        registerPoll: async () => ({verified: false}),
      }),
      createMockBlockstore(),
    )
    store.state.sessionChecked = true
    store.state.email = 'loop@example.com'
    store.state.delegationRequest = {
      originalUrl: 'http://localhost/vault?email=loop@example.com',
      clientId: 'http://localhost',
      redirectUri: 'http://localhost/callback',
      sessionKeyPrincipal: blobs.principalToString(blobs.generateNobleKeyPair().principal),
      state: base64.encode(new Uint8Array(16)),
      requestTs: Date.now(),
      proof: 'test-proof',
      vaultOrigin: 'http://localhost',
      email: 'loop@example.com',
    }

    const view = (
      <StoreContext.Provider value={store}>
        <PreLoginView />
      </StoreContext.Provider>
    )
    const rendered = rtl.render(view)

    await rtl.waitFor(() => {
      expect(registerStart).toHaveBeenCalledTimes(1)
    })

    rendered.rerender(view)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(registerStart).toHaveBeenCalledTimes(1)
  })

  test('does not auto-submit manually typed email in delegation flow', async () => {
    const registerStart = mock(async () => ({
      message: 'ok',
      challengeId: 'challenge-1',
    }))
    const store = createStore(
      createMockClient({
        preLogin: async () => ({exists: false}),
        registerStart,
        registerPoll: async () => ({verified: false}),
      }),
      createMockBlockstore(),
    )
    store.state.sessionChecked = true
    store.state.email = 'typed@example.com'
    store.state.delegationRequest = {
      originalUrl: 'http://localhost/vault',
      clientId: 'http://localhost',
      redirectUri: 'http://localhost/callback',
      sessionKeyPrincipal: blobs.principalToString(blobs.generateNobleKeyPair().principal),
      state: base64.encode(new Uint8Array(16)),
      requestTs: Date.now(),
      proof: 'test-proof',
      vaultOrigin: 'http://localhost',
    }

    rtl.render(
      <StoreContext.Provider value={store}>
        <PreLoginView />
      </StoreContext.Provider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(registerStart).not.toHaveBeenCalled()
  })
})
