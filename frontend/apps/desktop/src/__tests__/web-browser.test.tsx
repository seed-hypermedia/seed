import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {NavContextProvider, navStateReducer, type NavAction, type NavState} from '@shm/shared/utils/navigation'
import {eventStream, writeableStateStream} from '@shm/shared/utils/stream'
import {reconcileBrowserNavigation, type BrowserLocation} from '../browser-navigation'
import type {AppWindowEvent} from '../utils/window-events'

const mocks = vi.hoisted(() => ({
  enabled: true,
  send: vi.fn(),
  externalOpen: vi.fn(),
  commit: vi.fn(),
  resolveRoute: vi.fn(),
  resolve: vi.fn().mockResolvedValue(null),
}))
vi.mock('../models/experiments', () => ({useExperiments: () => ({data: {webBrowser: mocks.enabled}})}))
vi.mock('../app-context', () => ({useAppContext: () => ({externalOpen: mocks.externalOpen})}))
vi.mock('../grpc-client', () => ({domainResolver: {}}))
vi.mock('../ipc', () => ({ipc: {send: mocks.send}}))
vi.mock('../omnibar-url', () => ({resolveOmnibarUrlToRoute: mocks.resolve}))
vi.mock('../utils/navigation-container', () => ({
  commitBrowserLocation: mocks.commit,
  resolveBrowserRoute: mocks.resolveRoute,
}))

import {WebBrowser} from '../pages/web-browser'

describe('browser page lifecycle', () => {
  let root: Root
  let container: HTMLDivElement
  let dispatch: (action: NavAction) => void
  let getState: () => NavState
  let emit: (event: AppWindowEvent) => void
  const reload = vi.fn()
  const stop = vi.fn()

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    mocks.enabled = true
    mocks.send.mockClear()
    mocks.resolveRoute.mockClear()
    mocks.resolve.mockReset().mockResolvedValue(null)
    reload.mockClear()
    stop.mockClear()
    const [setState, state] = writeableStateStream<NavState>({
      routes: [{key: 'contacts'}, {key: 'web', url: 'https://example.com/a'}],
      routeIndex: 1,
      lastAction: 'push',
    })
    dispatch = (action) => setState(navStateReducer(state.get(), action))
    getState = state.get
    mocks.commit.mockImplementation((location: BrowserLocation, requested: boolean) => {
      setState(reconcileBrowserNavigation(state.get(), location, requested))
    })
    const [sendEvent, events] = eventStream<AppWindowEvent>()
    emit = sendEvent
    ;(window as any).appWindowEvents = events
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = createElement(tag, options)
      if (tag === 'webview') Object.assign(element, {getWebContentsId: () => 42, reload, stop})
      return element as Electron.WebviewTag
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root.render(
        <NavContextProvider value={{state, dispatch}}>
          <WebBrowser />
        </NavContextProvider>,
      ),
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function attachAndCommit() {
    act(() => container.querySelector('webview')!.dispatchEvent(new Event('did-attach')))
    const request = mocks.send.mock.lastCall![1]
    await act(async () => emit({type: 'browser-location', ...request, title: 'First page', historyIndex: 1}))
  }

  it('attaches once, records page navigation, and restores web history after a native Seed link', async () => {
    await attachAndCommit()
    const view = container.querySelector('webview')!
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(getState().routes[1]).toMatchObject({key: 'web', title: 'First page', historyIndex: 1})
    await act(async () =>
      emit({type: 'browser-location', browserId: 42, url: 'https://example.com/b', title: 'Second', historyIndex: 2}),
    )
    expect(getState().routeIndex).toBe(2)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    act(() => emit({type: 'browser-open-url', browserId: 42, url: 'hm://alice/docs'}))
    expect(getState().routes[3].key).toBe('document')
    expect(container.querySelector('webview')).toBe(view)
    expect(stop).toHaveBeenCalled()
    act(() => dispatch({type: 'pop'}))
    const request = mocks.send.mock.lastCall![1]
    expect(request).toMatchObject({url: 'https://example.com/b', historyIndex: 2})
    await act(async () => emit({type: 'browser-location', ...request, title: 'Second'}))
    expect(getState().routes).toHaveLength(4)
    expect(getState().routeIndex).toBe(2)
  })

  it('ignores stale navigation completions when a newer URL is already loading', async () => {
    act(() => container.querySelector('webview')!.dispatchEvent(new Event('did-attach')))
    const oldRequest = mocks.send.mock.lastCall![1]
    act(() => dispatch({type: 'push', route: {key: 'web', url: 'https://example.com/new'}}))
    await act(async () => emit({type: 'browser-location', ...oldRequest, historyIndex: 1, title: 'Stale'}))
    expect(getState().routes[getState().routeIndex]).toEqual({key: 'web', url: 'https://example.com/new'})
  })

  it('surfaces main-frame load errors with a working retry action', async () => {
    await attachAndCommit()
    const failed = Object.assign(new Event('did-fail-load'), {
      isMainFrame: true,
      errorCode: -105,
      errorDescription: 'Name not resolved',
    })
    act(() => container.querySelector('webview')!.dispatchEvent(failed))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Name not resolved')
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try again')!
    act(() => retry.click())
    expect(reload).toHaveBeenCalledOnce()
  })

  it('places the favicon before the title and refresh immediately before external open', async () => {
    await attachAndCommit()
    act(() =>
      emit({
        type: 'browser-favicons',
        browserId: 42,
        url: 'https://example.com/a',
        icons: ['data:image/png;base64,first', 'data:image/png;base64,second'],
      }),
    )
    const icon = container.querySelector('img')!
    expect(icon.nextElementSibling?.getAttribute('role')).toBe('status')
    const refresh = container.querySelector('[aria-label="Reload page"]')!
    expect(refresh.nextElementSibling?.getAttribute('aria-label')).toBe('Open in default browser')
    act(() => icon.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,second')
    act(() => dispatch({type: 'push', route: {key: 'web', url: 'https://other.example'}}))
    expect(container.querySelector('img')).toBeNull()
  })

  it('resolves custom-domain Seed pages after a committed website navigation', async () => {
    await attachAndCommit()
    mocks.resolve.mockResolvedValueOnce({key: 'contacts'})
    await act(async () =>
      emit({type: 'browser-location', browserId: 42, url: 'https://seed.example/docs', title: 'Seed', historyIndex: 2}),
    )
    expect(mocks.resolveRoute).toHaveBeenCalledWith('https://seed.example/docs', {key: 'contacts'})
  })

  it('destroys the guest when disabled and leaves an external-browser fallback', async () => {
    await attachAndCommit()
    mocks.enabled = false
    act(() => dispatch({type: 'replace', route: {...getState().routes[getState().routeIndex]}}))
    expect(container.querySelector('webview')).toBeNull()
    expect(container.textContent).toContain('The experimental web browser is disabled.')
  })
})
