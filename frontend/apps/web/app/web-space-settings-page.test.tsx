// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
const state = vi.hoisted(() => ({
  resource: {} as any,
  header: vi.fn(),
  provider: vi.fn(),
  settings: vi.fn(),
  domain: vi.fn(),
  load: vi.fn(),
}))
vi.mock('@/client-lazy', () => ({ClientOnly: ({children}: any) => children}))
vi.mock('@/providers', () => ({
  WebSiteProvider: ({children, ...props}: any) => {
    state.provider(props)
    return children
  },
  NavigationLoadingContent: ({children, ...props}: any) => <main {...props}>{children}</main>,
}))
vi.mock('@/web-site-header', () => ({
  WebSiteHeader: (props: any) => {
    state.header(props)
    return <header>{props.rightActions}</header>
  },
}))
vi.mock('@/web-utils', () => ({WebHeaderActions: ({siteUid}: any) => <span>Account actions for {siteUid}</span>}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: any) => {
    state.load(id)
    return state.resource
  },
}))
vi.mock('./components/web-space-settings', () => ({
  WebSpaceSettingsPage: (props: any) => {
    state.settings(props)
    return <section>Settings content</section>
  },
}))
vi.mock('./components/web-hosting', () => ({
  WebDomainSetupPage: (props: any) => {
    state.domain(props)
    return <section>Domain progress</section>
  },
}))
import {WebSpaceSettingsScreen} from './web-space-settings-page'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  state.resource = {data: undefined}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
const payload = {
  kind: 'site-settings',
  siteUid: 'owner',
  origin: 'https://gateway.test',
  siteHost: 'gateway.test',
  originHomeId: {uid: 'gateway', id: 'hm://gateway'},
  homeMetadata: {name: 'Gateway'},
} as any
it('keeps the viewed space separate from the gateway in header, ownership actions, and navigation', async () => {
  state.resource = {
    data: {type: 'document', document: {metadata: {name: 'Owned space', theme: {headerLayout: 'Center'}}}},
  }
  await act(async () => root.render(<WebSpaceSettingsScreen payload={{...payload, section: 'navigation'}} />))
  expect(state.header).toHaveBeenLastCalledWith(
    expect.objectContaining({
      originHomeId: expect.objectContaining({uid: 'gateway'}),
      siteHomeId: expect.objectContaining({uid: 'owner'}),
      homeMetadata: {name: 'Owned space', theme: {headerLayout: 'Center'}},
    }),
  )
  expect(state.provider).toHaveBeenCalledWith(
    expect.objectContaining({
      initialRoute: {key: 'site-settings', id: expect.objectContaining({uid: 'owner'}), tab: 'navigation'},
    }),
  )
  expect(state.settings).toHaveBeenCalledWith({siteUid: 'owner', section: 'navigation'})
  expect(container.textContent).toContain('Account actions for owner')
  expect(state.load).toHaveBeenCalledWith(expect.objectContaining({uid: 'owner'}))
})
it('does not show gateway branding while the viewed space is loading and preserves the mobile master route', async () => {
  await act(async () => root.render(<WebSpaceSettingsScreen payload={payload} />))
  expect(state.header).toHaveBeenLastCalledWith(expect.objectContaining({homeMetadata: null}))
  expect(state.settings).toHaveBeenCalledWith({siteUid: 'owner', section: undefined})
})

it('mounts full-page setup with its stable space and hostname from the URL', async () => {
  await act(async () =>
    root.render(<WebSpaceSettingsScreen payload={{...payload, section: 'web-domain', domain: 'www.example.com'}} />),
  )
  expect(state.domain).toHaveBeenCalledWith({
    siteId: expect.objectContaining({uid: 'owner'}),
    hostname: 'www.example.com',
  })
  expect(state.settings).not.toHaveBeenCalled()
  expect(state.provider).toHaveBeenCalledWith(
    expect.objectContaining({
      initialRoute: expect.objectContaining({key: 'site-settings', tab: 'web-domain', domain: 'www.example.com'}),
    }),
  )
})
