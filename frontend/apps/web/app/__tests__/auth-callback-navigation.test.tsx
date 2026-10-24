// @vitest-environment jsdom

import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  enterprise: false,
  returnUrl: '/private?view=recent#notes',
  handleCallback: vi.fn(),
  ensureDaemonAuth: vi.fn(),
  publish: vi.fn(),
  writeLocalKeys: vi.fn(),
  setIdentity: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  intent: vi.fn(),
  hostingReturn: vi.fn(),
  setHostingRequest: vi.fn(),
}))

vi.mock('@/auth', () => ({keyPairStore: {set: mocks.setIdentity}}))
vi.mock('@/auth-session', () => ({handleCallback: mocks.handleCallback, clearSession: vi.fn().mockResolvedValue(null)}))
vi.mock('@/local-db', () => ({
  AUTH_STATE_DELEGATION_RETURN_URL: 'return',
  AUTH_STATE_DELEGATION_VAULT_URL: 'vault',
  getAuthState: async (key: string) => (key === 'return' ? mocks.returnUrl : '/vault/delegate'),
  deleteAuthState: vi.fn().mockResolvedValue(null),
  writeLocalKeys: mocks.writeLocalKeys,
}))
vi.mock('@/models', () => ({queryAPI: async () => ({type: 'account'})}))
vi.mock('@/models/domain-publishing', () => ({
  saveWebDomainReturn: vi.fn().mockResolvedValue(null),
  setWebDomainRequest: mocks.setHostingRequest,
  takeWebDomainReturn: mocks.hostingReturn,
}))
vi.mock('@/pending-intent', () => ({getSiteMembershipStatus: async () => null, processPendingIntent: mocks.intent}))
vi.mock('@/universal-client', () => ({
  ensureDaemonAuth: mocks.ensureDaemonAuth,
  webUniversalClient: {publish: mocks.publish},
}))
vi.mock('@remix-run/react', () => ({
  useNavigate: () => mocks.navigate,
  useLoaderData: () => ({requireSignIn: mocks.enterprise}),
}))
vi.mock('@seed-hypermedia/client', () => ({createSeedClient: vi.fn()}))
vi.mock('@shm/shared', () => ({useUniversalAppContext: () => ({origin: 'https://site.example'})}))
vi.mock('@shm/shared/constants', () => ({WEB_IDENTITY_ORIGIN: ''}))
vi.mock('@shm/shared/blobs', () => ({
  WebCryptoKeyPair: class {
    constructor(public keyPair: object) {}
  },
  principalFromString: (uid: string) => uid,
  createCapability: async () => ({cid: 'reverse-cap', data: new Uint8Array()}),
  createProfileAlias: async () => ({cid: 'reverse-profile', data: new Uint8Array()}),
}))
vi.mock('@shm/ui/button', () => ({Button: ({children}: React.PropsWithChildren) => <button>{children}</button>}))
vi.mock('@shm/ui/text', () => ({SizableText: ({children}: React.PropsWithChildren) => <span>{children}</span>}))
vi.mock('lucide-react', () => ({XCircle: () => null}))

import AuthCallbackRoute from '../routes/hm.auth.callback'

describe('sign-in destination navigation', () => {
  let root: Root
  let container: HTMLDivElement
  let flowId = 0

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enterprise = false
    mocks.returnUrl = '/private?view=recent#notes'
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // jsdom cannot navigate documents; observe the navigation boundary instead.
    const location = {
      href: `https://site.example/hm/auth/callback?flow=${++flowId}`,
      origin: 'https://site.example',
      replace: mocks.replace,
    }
    vi.stubGlobal(
      'window',
      new Proxy(window, {get: (target, key) => (key === 'location' ? location : Reflect.get(target, key, target))}),
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    mocks.handleCallback.mockResolvedValue({
      accountPrincipal: 'account',
      session: {keyPair: {}, publicKeyRaw: new Uint8Array(), principal: 'session'},
      capability: {cid: 'capability', data: new Uint8Array()},
    })
    mocks.publish.mockResolvedValue({})
    mocks.writeLocalKeys.mockResolvedValue(undefined)
    mocks.intent.mockResolvedValue({type: 'none'})
    mocks.hostingReturn.mockResolvedValue(null)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('keeps the callback open until the identity is saved and the site session is ready, then loads a fresh destination', async () => {
    let sessionReady!: () => void
    mocks.ensureDaemonAuth.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          sessionReady = resolve
        }),
    )
    await act(async () => {
      root.render(<AuthCallbackRoute />)
    })
    expect(mocks.writeLocalKeys).toHaveBeenCalledOnce()
    expect(mocks.setIdentity).toHaveBeenCalledOnce()
    expect(mocks.ensureDaemonAuth).toHaveBeenCalledOnce()
    expect(mocks.replace).not.toHaveBeenCalled()
    await act(async () => {
      sessionReady()
    })
    expect(mocks.replace).toHaveBeenCalledWith('/private?view=recent&vault_success=welcome-back#notes')
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('stays on the error screen when the site rejects the session', async () => {
    mocks.ensureDaemonAuth.mockRejectedValue(new Error('Not a site member'))
    await act(async () => {
      root.render(<AuthCallbackRoute />)
    })
    expect(container.textContent).toContain("We couldn't sign you in")
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('uses one stable enterprise loader while the site session is pending', async () => {
    mocks.enterprise = true
    mocks.ensureDaemonAuth.mockImplementation(() => new Promise(() => {}))
    await act(async () => root.render(<AuthCallbackRoute />))
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Signing in')
    expect(container.textContent).toBe('')
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it.each([
    ['/hm/sign-in?next=%2Fnotes%3Fview%3Drecent%23section', '/notes?view=recent&vault_success=welcome-back#section'],
    ['/hm/sign-in?next=https%3A%2F%2Fexternal.example', '/?vault_success=welcome-back'],
  ])('finishes an older enterprise return URL directly and safely: %s', async (returnUrl, destination) => {
    mocks.enterprise = true
    mocks.returnUrl = returnUrl
    mocks.ensureDaemonAuth.mockResolvedValue(undefined)
    await act(async () => root.render(<AuthCallbackRoute />))
    expect(mocks.replace).toHaveBeenCalledWith(destination)
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('restores a hosting dialog without discarding it during navigation', async () => {
    mocks.ensureDaemonAuth.mockResolvedValue(undefined)
    const hosting = {id: {uid: 'account'}, requesterUid: 'account', view: 'hosting'}
    mocks.hostingReturn.mockResolvedValue(hosting)
    await act(async () => {
      root.render(<AuthCallbackRoute />)
    })
    expect(mocks.setHostingRequest).toHaveBeenCalledWith(hosting)
    expect(mocks.navigate).toHaveBeenCalledWith('/private?view=recent#notes', {replace: true, state: undefined})
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it.each([
    [{type: 'join', joinStatus: 'joined'}, '/private?view=recent&vault_success=join#notes'],
    [{type: 'follow'}, '/private?view=recent&vault_success=welcome-back#notes'],
    [{type: 'publish-draft', spaceUrl: '/hm/account'}, '/hm/account?vault_success=publish-draft'],
    [{type: 'publish-draft-failed', retryUrl: '/draft/retry'}, '/draft/retry'],
    [
      {type: 'publish-draft-existing-space', spaceUrl: '/hm/account', draftId: 'draft'},
      '/private?view=recent&vault_success=space-exists&vault_space_url=%2Fhm%2Faccount&vault_draft_id=draft#notes',
    ],
  ])('preserves the in-memory continuation for %j', async (intent, destination) => {
    mocks.ensureDaemonAuth.mockResolvedValue(undefined)
    mocks.intent.mockResolvedValue(intent)
    await act(async () => {
      root.render(<AuthCallbackRoute />)
    })
    expect(mocks.navigate).toHaveBeenCalledWith(destination, {replace: true, state: undefined})
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('preserves the published comment and its destination when resuming a pending comment', async () => {
    mocks.ensureDaemonAuth.mockResolvedValue(undefined)
    mocks.intent.mockResolvedValue({
      type: 'comment',
      commentUrl: '/notes?comment=published#discussion',
      comment: {id: 'published'},
    })
    await act(async () => {
      root.render(<AuthCallbackRoute />)
    })
    expect(mocks.navigate).toHaveBeenCalledWith('/notes?comment=published&vault_success=comment#discussion', {
      replace: true,
      state: {submittedComment: {id: 'published'}},
    })
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
