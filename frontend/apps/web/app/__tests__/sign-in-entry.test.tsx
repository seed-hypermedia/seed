// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
const mocks = vi.hoisted(() => ({
  enterprise: false,
  logout: vi.fn(),
  redirect: vi.fn(),
  key: null as object | null,
  ensure: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('@/auth', () => ({
  logout: mocks.logout,
  redirectToVaultSignIn: mocks.redirect,
  useLocalKeyPair: () => mocks.key,
  useLocalKeyPairLoaded: () => true,
}))
vi.mock('@/daemon-auth.server', () => ({getDaemonAuthToken: vi.fn(), withDaemonAuthToken: vi.fn()}))
vi.mock('@/loaders', () => ({loadSiteHeaderData: vi.fn()}))
vi.mock('@/meta', () => ({defaultSiteIcon: ''}))
vi.mock('@/providers', () => ({getOptimizedImageUrl: vi.fn()}))
vi.mock('@/request', () => ({parseRequest: vi.fn()}))
vi.mock('@/invite-join', () => ({markInviteJoin: vi.fn()}))
vi.mock('@/universal-client', () => ({ensureDaemonAuth: mocks.ensure}))
vi.mock('@remix-run/react', () => ({
  useLoaderData: () => ({siteName: 'Test Site', requireSignIn: mocks.enterprise}),
  useSearchParams: () => [new URLSearchParams({next: '/notes?view=recent'})],
}))
vi.mock('@shm/shared', () => ({hostnameStripProtocol: vi.fn()}))
vi.mock('@shm/shared/constants', () => ({WEB_IDENTITY_ORIGIN: ''}))
vi.mock('@shm/ui/button', () => ({
  Button: ({children, onClick}: React.PropsWithChildren<{onClick?: () => void}>) => (
    <button onClick={onClick}>{children}</button>
  ),
}))
vi.mock('@shm/ui/text', () => ({SizableText: ({children}: React.PropsWithChildren) => <span>{children}</span>}))
vi.mock('@shm/ui/get-file-url', () => ({extractIpfsUrlCid: vi.fn()}))
import SignInPage from '../routes/hm.sign-in'
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  mocks.enterprise = false
  mocks.key = null
  mocks.redirect.mockResolvedValue(undefined)
  mocks.ensure.mockResolvedValue(undefined)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const location = {origin: 'https://site.example', replace: mocks.replace}
  vi.stubGlobal(
    'window',
    new Proxy(window, {get: (target, key) => (key === 'location' ? location : Reflect.get(target, key, target))}),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('public sign-in keeps its existing text, button, and explicit interaction', async () => {
  await act(async () => root.render(<SignInPage />))
  expect(mocks.redirect).not.toHaveBeenCalled()
  expect(container.textContent).toBe('Sign in to Test SiteThis site is only available to signed-in members.Sign in')
  await act(async () => container.querySelector('button')!.click())
  expect(mocks.redirect).toHaveBeenCalledOnce()
  expect(mocks.redirect).toHaveBeenCalledWith(
    expect.objectContaining({returnUrl: '/hm/sign-in?next=%2Fnotes%3Fview%3Drecent'}),
  )
})
it('enterprise sign-in starts once and preserves the requested site destination', async () => {
  mocks.enterprise = true
  await act(async () => root.render(<SignInPage />))
  expect(mocks.redirect).toHaveBeenCalledOnce()
  expect(mocks.redirect).toHaveBeenCalledWith(
    expect.objectContaining({
      returnUrl: '/notes?view=recent',
      vaultUrl: 'https://site.example/vault/delegate',
    }),
  )
  expect(container.querySelector('button')).toBeNull()
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Signing in')
})
it('a saved identity renews its site session without starting a second vault login', async () => {
  mocks.enterprise = true
  mocks.key = {id: 'saved'}
  await act(async () => root.render(<SignInPage />))
  expect(mocks.ensure).toHaveBeenCalledOnce()
  expect(mocks.replace).toHaveBeenCalledWith('/notes?view=recent')
  expect(mocks.redirect).not.toHaveBeenCalled()
})

it('retrying a rejected saved identity starts only one new login', async () => {
  mocks.enterprise = true
  mocks.key = {id: 'stale'}
  mocks.ensure.mockRejectedValue(new Error('Site session rejected'))
  mocks.logout.mockImplementation(async () => {
    mocks.key = null
  })
  await act(async () => root.render(<SignInPage />))
  await act(async () => container.querySelector('button')!.click())
  expect(mocks.logout).toHaveBeenCalledOnce()
  expect(mocks.redirect).toHaveBeenCalledOnce()
})
