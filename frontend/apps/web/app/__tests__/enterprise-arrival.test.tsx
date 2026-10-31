// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({enterprise: true, loaded: false, pathname: '/notes'}))
vi.mock('@remix-run/react', () => ({
  useRouteLoaderData: () => ({requireSignIn: state.enterprise}),
  useLocation: () => ({pathname: state.pathname}),
  Outlet: () => <main>Site content</main>,
}))
vi.mock('@sentry/remix', () => ({withSentry: (component: unknown) => component}))
vi.mock('../auth', () => ({useLocalKeyPairLoaded: () => state.loaded}))
vi.mock('../providers', () => ({Providers: ({children}: React.PropsWithChildren) => children}))
vi.mock('@shm/editor/editor-styles', () => ({}))
// This component test does not run the loader or need deployment config files.
vi.mock('../site-config.server', () => ({getServiceConfig: async () => null}))
import App from '../root'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  state.enterprise = true
  state.loaded = false
  state.pathname = '/notes'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('keeps the enterprise loading surface until the saved identity has loaded', async () => {
  await act(async () => root.render(<App />))
  expect(container.querySelector('main')).toBeNull()
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Signing in')
  state.loaded = true
  await act(async () => root.render(<App />))
  expect(container.textContent).toBe('Site content')
  expect(container.querySelector('[role="status"]')).toBeNull()
})
it('leaves public rendering unchanged while identity is loading', async () => {
  state.enterprise = false
  await act(async () => root.render(<App />))
  expect(container.textContent).toBe('Site content')
  expect(container.querySelector('[role="status"]')).toBeNull()
})
it.each(['/hm/sign-in', '/hm/auth/callback', '/hm/email-notifications'])(
  'keeps the open route %s accessible before identity load',
  async (pathname) => {
    state.pathname = pathname
    await act(async () => root.render(<App />))
    expect(container.textContent).toBe('Site content')
  },
)
