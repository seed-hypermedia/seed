import * as rtl from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as ReactRouter from 'react-router-dom'
import {APIError} from './api-client'
import * as navigation from './navigation'
import {createRouter} from './router'
import {StoreContext, createStore} from './store'
import {createMockBlockstore, createMockClient} from './test-utils'

function setWindowUrl(url: string) {
  const testWindow = window as unknown as {happyDOM: {setURL(url: string): void}}
  testWindow.happyDOM.setURL(url)
}

const inviteCode = 'A'.repeat(43)

describe('invite-only registration', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('store reads the invite from the URL and sends it with both registration requests', async () => {
    const registerStart = mock(async (_req: {email: string; invite?: string}) => ({
      message: 'ok',
      expireTime: Date.now() + 15 * 60 * 1000,
      resendAllowedTime: Date.now() + 60 * 1000,
    }))
    const registerVerify = mock(async (_req: {code: string; invite?: string}) => ({verified: true, userId: 'user-1'}))
    const client = createMockClient({
      preLogin: async () => ({exists: false}),
      getSession: async () => ({authenticated: true, relyingPartyOrigin: window.location.origin, userId: 'user-1'}),
      registerStart,
      registerVerify,
    })
    const {state, actions, navigator} = createStore(client, createMockBlockstore(), '', '', '', true)
    navigator.setNavigate(() => {})

    actions.parseInviteFromUrl('http://localhost/vault?invite=%20' + inviteCode + '%20')
    expect(state.inviteCode).toBe(inviteCode)

    state.email = 'new@user.com'
    await actions.handlePreLogin()
    expect(registerStart).toHaveBeenCalledWith({email: 'new@user.com', invite: inviteCode})

    await actions.handleRegisterVerify('1234')
    expect(registerVerify).toHaveBeenCalledWith({code: '1234', invite: inviteCode})
  })

  test('store leaves the invite out when none is set', async () => {
    const registerStart = mock(async (_req: {email: string; invite?: string}) => ({
      message: 'ok',
      expireTime: Date.now() + 15 * 60 * 1000,
      resendAllowedTime: Date.now() + 60 * 1000,
    }))
    const client = createMockClient({preLogin: async () => ({exists: false}), registerStart})
    const {state, actions, navigator} = createStore(client, createMockBlockstore())
    navigator.setNavigate(() => {})

    actions.parseInviteFromUrl('http://localhost/vault')
    expect(state.inviteCode).toBe('')

    state.email = 'new@user.com'
    await actions.handlePreLogin()
    expect(registerStart).toHaveBeenCalledWith({email: 'new@user.com'})
  })

  test('pre-login screen shows the invite input prefilled from the URL and surfaces the server error', async () => {
    const registerStart = mock(async (_req: {email: string; invite?: string}) => {
      throw new APIError('This invitation code has already been used.', 403)
    })
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
      preLogin: async () => ({exists: false}),
      registerStart,
    })
    setWindowUrl(`http://localhost/vault?invite=${inviteCode}`)
    const store = createStore(client, createMockBlockstore(), '', '', '', true)
    const router = createRouter()
    store.navigator.setNavigate((path) => router.navigate(navigation.withHash(path)))

    await rtl.act(async () => {
      rtl.render(
        <StoreContext.Provider value={store}>
          <ReactRouter.RouterProvider router={router} />
        </StoreContext.Provider>,
      )
    })

    const inviteInput = (await rtl.screen.findByLabelText('Invitation code')) as HTMLInputElement
    expect(inviteInput.value).toBe(inviteCode)

    const emailInput = rtl.screen.getByLabelText('Enter your email to continue')
    await rtl.act(async () => {
      rtl.fireEvent.change(emailInput, {target: {value: 'new@user.com'}})
    })
    await rtl.act(async () => {
      rtl.fireEvent.submit(emailInput.closest('form')!)
    })

    expect(registerStart).toHaveBeenCalledWith({email: 'new@user.com', invite: inviteCode})
    await rtl.screen.findByText('This invitation code has already been used.')
  })

  test('pre-login screen hides the invite input when the vault is open', async () => {
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
    })
    setWindowUrl('http://localhost/vault')
    const store = createStore(client, createMockBlockstore())
    const router = createRouter()

    await rtl.act(async () => {
      rtl.render(
        <StoreContext.Provider value={store}>
          <ReactRouter.RouterProvider router={router} />
        </StoreContext.Provider>,
      )
    })

    await rtl.screen.findByLabelText('Enter your email to continue')
    expect(rtl.screen.queryByLabelText('Invitation code')).toBeNull()
  })
})
