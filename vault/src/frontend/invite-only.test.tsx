import * as base64 from '@seed-hypermedia/client/base64'
import * as blobs from '@shm/shared/blobs'
import * as rtl from '@testing-library/react'
import {afterEach, describe, expect, mock, spyOn, test} from 'bun:test'
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
const invitedEmail = 'new@user.com'

/**
 * The URL the site's sign-in page sends an invited person to: a delegation
 * request with the invitation attached. (`proof` is only verified when the
 * delegation completes.)
 */
function inviteViaSiteUrl(email?: string) {
  const sessionKey = blobs.generateNobleKeyPair()
  const vaultOrigin = 'http://localhost'
  const url = new URL('/vault/delegate', vaultOrigin)
  url.searchParams.set('client_id', vaultOrigin)
  url.searchParams.set('redirect_uri', `${vaultOrigin}/hm/auth/callback`)
  url.searchParams.set('session_key', blobs.principalToString(sessionKey.principal))
  url.searchParams.set('state', base64.encode(new Uint8Array(16)))
  url.searchParams.set('ts', String(Date.now()))
  url.searchParams.set('invite', inviteCode)
  if (email) url.searchParams.set('email', email)
  url.searchParams.set('proof', 'test-proof')
  return url.toString()
}

function registerStartMock() {
  return mock(async (_req: {email: string; invite?: string}) => ({
    message: 'ok',
    expireTime: Date.now() + 15 * 60 * 1000,
    resendAllowedTime: Date.now() + 60 * 1000,
  }))
}

/** Mounts the app at the current window URL with `client`, in invite-only mode. */
async function renderApp(client: ReturnType<typeof createMockClient>, relyingPartyName = 'Acme Vault') {
  const store = createStore(client, createMockBlockstore(), '', '', '', true, relyingPartyName)
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

describe('invite-only registration', () => {
  afterEach(() => {
    rtl.cleanup()
    setWindowUrl('http://localhost/')
  })

  test('store reads the invite and email from the URL and registers without an emailed code', async () => {
    const registerStart = registerStartMock()
    const registerInvited = mock(async (_req: {email: string; invite: string}) => ({verified: true, userId: 'user-1'}))
    const getInvitation = mock(async (_req: {code: string}) => ({email: invitedEmail, valid: true as const}))
    const client = createMockClient({
      getSession: async () => ({authenticated: true, relyingPartyOrigin: window.location.origin, userId: 'user-1'}),
      getInvitation,
      registerStart,
      registerInvited,
    })
    const {state, actions, navigator} = createStore(client, createMockBlockstore(), '', '', '', true)
    navigator.setNavigate(() => {})

    expect(actions.parseInviteFromUrl(`http://localhost/vault?invite=%20${inviteCode}%20&email=New%40User.com`)).toBe(
      true,
    )
    expect(state.inviteCode).toBe(inviteCode)
    expect(state.inviteEmail).toBe('New@User.com')
    expect(state.email).toBe('New@User.com')
    expect(state.inviteStatus).toBe('checking')

    // The server's answer is authoritative for the email.
    await actions.checkInvitation()
    expect(getInvitation).toHaveBeenCalledWith({code: inviteCode})
    expect(state.inviteStatus).toBe('valid')
    expect(state.inviteEmail).toBe(invitedEmail)
    expect(state.email).toBe(invitedEmail)

    const visited: string[] = []
    navigator.setNavigate((path) => visited.push(path))
    await actions.handleInvitedContinue()
    expect(registerInvited).toHaveBeenCalledWith({email: invitedEmail, invite: inviteCode})
    // No verification code round trip: straight to choosing a passkey or password.
    expect(registerStart).not.toHaveBeenCalled()
    expect(visited).toEqual(['/auth/choose'])
  })

  test('store marks the invitation invalid on 404 and failed on other lookup errors', async () => {
    const notFound = createMockClient({
      getInvitation: async () => {
        throw new APIError('Invitation not found', 404)
      },
    })
    const {state, actions} = createStore(notFound, createMockBlockstore(), '', '', '', true)
    actions.parseInviteFromUrl(`http://localhost/vault?invite=${inviteCode}`)
    await actions.checkInvitation()
    expect(state.inviteStatus).toBe('invalid')
    // Nothing to continue with.
    await actions.handleInvitedContinue()

    const broken = createMockClient({
      getInvitation: async () => {
        throw new Error('network down')
      },
    })
    const failedStore = createStore(broken, createMockBlockstore(), '', '', '', true)
    failedStore.actions.parseInviteFromUrl(`http://localhost/vault?invite=${inviteCode}&email=${invitedEmail}`)
    await failedStore.actions.checkInvitation()
    expect(failedStore.state.inviteStatus).toBe('failed')
    expect(failedStore.state.inviteEmail).toBe(invitedEmail)
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

    expect(actions.parseInviteFromUrl('http://localhost/vault')).toBe(false)
    expect(state.inviteCode).toBe('')
    expect(state.inviteStatus).toBe('none')

    state.email = 'new@user.com'
    await actions.handlePreLogin()
    expect(registerStart).toHaveBeenCalledWith({email: 'new@user.com'})
  })

  test('invitation link shows the invited screen with a locked email and a single Continue action', async () => {
    const registerStart = registerStartMock()
    const registerInvited = mock(async (_req: {email: string; invite: string}) => ({verified: true, userId: 'user-1'}))
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
      getInvitation: async () => ({email: invitedEmail, valid: true as const}),
      registerStart,
      registerInvited,
    })
    setWindowUrl(inviteViaSiteUrl(invitedEmail))
    await renderApp(client)

    await rtl.screen.findByText("You've been invited")
    rtl.screen.getByText('to Acme Vault')

    const emailInput = (await rtl.screen.findByLabelText('Your email')) as HTMLInputElement
    expect(emailInput.value).toBe(invitedEmail)
    expect(emailInput.readOnly).toBe(true)

    // The code stays in state; nothing from the regular pre-login screen leaks in.
    expect(document.body.textContent).not.toContain(inviteCode)
    expect(rtl.screen.queryByLabelText('Invitation code')).toBeNull()
    expect(rtl.screen.queryByLabelText('Enter your email to continue')).toBeNull()
    expect(rtl.screen.queryByText(/Terms and Privacy Policy/)).toBeNull()
    expect(rtl.screen.queryByText(/Sign in/)).toBeNull()
    expect(rtl.screen.queryByText('Send code')).toBeNull()

    const buttons = rtl.screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Continue'])
    const continueButton = buttons[0]!
    await rtl.waitFor(() => expect((continueButton as HTMLButtonElement).disabled).toBe(false))
    await rtl.act(async () => {
      rtl.fireEvent.click(continueButton)
    })

    // The link already proved the address: no "check your inbox" step.
    expect(registerInvited).toHaveBeenCalledWith({email: invitedEmail, invite: inviteCode})
    expect(registerStart).not.toHaveBeenCalled()
    await rtl.waitFor(() => expect(window.location.pathname).toContain('/auth/choose'))
    expect(rtl.screen.queryByText('Check your inbox')).toBeNull()
  })

  test('invited screen takes the email from the lookup when the link lost it, and names the host without an rp name', async () => {
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
      getInvitation: async () => ({email: invitedEmail, valid: true as const}),
    })
    setWindowUrl(inviteViaSiteUrl())
    await renderApp(client, '')

    await rtl.screen.findByText("You've been invited")
    rtl.screen.getByText('to localhost')
    const emailInput = (await rtl.screen.findByLabelText('Your email')) as HTMLInputElement
    await rtl.waitFor(() => expect(emailInput.value).toBe(invitedEmail))
    expect(emailInput.readOnly).toBe(true)
  })

  test('invited screen surfaces the server error from registration', async () => {
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
      getInvitation: async () => ({email: invitedEmail, valid: true as const}),
      registerInvited: async () => {
        throw new APIError('User already exists', 409)
      },
    })
    setWindowUrl(inviteViaSiteUrl(invitedEmail))
    await renderApp(client)

    const continueButton = (await rtl.screen.findByRole('button', {name: 'Continue'})) as HTMLButtonElement
    await rtl.waitFor(() => expect(continueButton.disabled).toBe(false))
    await rtl.act(async () => {
      rtl.fireEvent.click(continueButton)
    })
    await rtl.screen.findByText('User already exists')
  })

  test('an invitation opened on the vault itself is sent through the site sign-in, with the delegation to come back with', async () => {
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
      getInvitation: async () => ({email: invitedEmail, valid: true as const}),
    })
    const replace = spyOn(window.location, 'replace').mockImplementation(() => {})
    try {
      setWindowUrl(`http://localhost/vault?invite=${inviteCode}&email=${encodeURIComponent(invitedEmail)}`)
      await renderApp(client)

      await rtl.screen.findByText('Opening your invitation')
      await rtl.waitFor(() => expect(replace).toHaveBeenCalled())
      const target = new URL(replace.mock.calls[0]![0] as string)
      expect(target.origin).toBe('http://localhost')
      expect(target.pathname).toBe('/hm/sign-in')
      expect(target.searchParams.get('invite')).toBe(inviteCode)
      expect(target.searchParams.get('email')).toBe(invitedEmail)
      expect(rtl.screen.queryByRole('button', {name: 'Continue'})).toBeNull()
    } finally {
      replace.mockRestore()
    }
  })

  test('used or unknown invitation shows a message instead of a form', async () => {
    const registerStart = registerStartMock()
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
      getInvitation: async () => {
        throw new APIError('Invitation not found', 404)
      },
      registerStart,
    })
    setWindowUrl(`http://localhost/vault?invite=${inviteCode}&email=${encodeURIComponent(invitedEmail)}`)
    await renderApp(client)

    await rtl.screen.findByText("You've been invited")
    await rtl.screen.findByText(/This invitation was already used or is invalid/)
    expect(rtl.screen.queryByLabelText('Your email')).toBeNull()
    expect(rtl.screen.queryByRole('button', {name: 'Continue'})).toBeNull()
    expect(rtl.screen.queryByLabelText('Enter your email to continue')).toBeNull()
    expect(document.querySelector('form')).toBeNull()
    expect(registerStart).not.toHaveBeenCalled()
  })

  test('pre-login screen without a link keeps the invite input and the invite-only hint', async () => {
    const client = createMockClient({
      getSession: async () => ({authenticated: false, relyingPartyOrigin: window.location.origin}),
    })
    setWindowUrl('http://localhost/vault')
    await renderApp(client)

    await rtl.screen.findByLabelText('Enter your email to continue')
    rtl.screen.getByLabelText('Invitation code')
    rtl.screen.getByText(/This vault is invite-only. A code is required to create a new account/)
    rtl.screen.getByText('Send code')
    rtl.screen.getByText(/Terms and Privacy Policy/)
    expect(rtl.screen.queryByText("You've been invited")).toBeNull()
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
