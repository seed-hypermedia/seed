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
  clearData: vi.fn().mockResolvedValue(undefined),
  send: vi.fn(),
  invoke: vi.fn(),
  externalOpen: vi.fn(),
  commit: vi.fn(),
  resolveRoute: vi.fn(),
  resolve: vi.fn().mockResolvedValue(null),
}))
vi.mock('../trpc', () => ({client: {experiments: {clearBrowserData: {mutate: mocks.clearData}}}}))
vi.mock('../models/experiments', () => ({useExperiments: () => ({data: {webBrowser: mocks.enabled}})}))
vi.mock('../app-context', () => ({useAppContext: () => ({externalOpen: mocks.externalOpen})}))
vi.mock('../grpc-client', () => ({domainResolver: {}}))

vi.mock('../omnibar-url', () => ({resolveOmnibarUrlToRoute: mocks.resolve}))
vi.mock('../utils/navigation-container', () => ({
  commitBrowserLocation: mocks.commit,
  resolveBrowserRoute: mocks.resolveRoute,
}))

import {WebBrowser, displayedOrigin} from '../pages/web-browser'

describe('browser page lifecycle', () => {
  let root: Root
  let container: HTMLDivElement
  let dispatch: (action: NavAction) => void
  let getState: () => NavState
  let emit: (event: AppWindowEvent) => void
  /** Commands sent to the main process for one IPC channel. */
  const sent = (command: string) => mocks.send.mock.calls.filter((call) => call[0] === command).map((call) => call[1])

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    mocks.clearData.mockReset().mockResolvedValue(undefined)
    mocks.enabled = true
    mocks.send.mockClear()
    mocks.invoke.mockReset().mockResolvedValue({browserId: 42})
    ;(window as any).webBrowser = {
      create: mocks.invoke,
      destroy: (input: unknown) => {
        mocks.send('web-browser-destroy', input)
        return Promise.resolve()
      },
      setBounds: (input: unknown) => mocks.send('web-browser-bounds', input),
      control: (input: unknown) => mocks.send('web-browser-control', input),
      navigate: (input: unknown) => mocks.send('web-browser-navigate', input),
    }
    mocks.resolveRoute.mockClear()
    mocks.resolve.mockReset().mockResolvedValue(null)
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

  /** Lets the guest creation resolve, then completes the first navigation it requested. */
  async function attachAndCommit() {
    await act(async () => {})
    const request = sent('web-browser-navigate').at(-1)
    await act(async () => emit({type: 'browser-location', ...request, title: 'First page', historyIndex: 1}))
  }

  it('attaches once, records page navigation, and restores web history after a native Seed link', async () => {
    await attachAndCommit()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(sent('web-browser-navigate')).toHaveLength(1)
    expect(getState().routes[1]).toMatchObject({key: 'web', title: 'First page', historyIndex: 1})
    await act(async () =>
      emit({type: 'browser-location', browserId: 42, url: 'https://example.com/b', title: 'Second', historyIndex: 2}),
    )
    expect(getState().routeIndex).toBe(2)
    expect(sent('web-browser-navigate')).toHaveLength(1)
    act(() => emit({type: 'browser-open-url', browserId: 42, url: 'hm://alice/docs'}))
    expect(getState().routes[3].key).toBe('document')
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(sent('web-browser-control').at(-1)).toEqual({browserId: 42, action: 'stop'})
    expect(sent('web-browser-bounds').at(-1)).toMatchObject({browserId: 42, visible: false})
    act(() => dispatch({type: 'pop'}))
    const request = sent('web-browser-navigate').at(-1)
    expect(request).toMatchObject({url: 'https://example.com/b', historyIndex: 2})
    await act(async () => emit({type: 'browser-location', ...request, title: 'Second'}))
    expect(getState().routes).toHaveLength(4)
    expect(getState().routeIndex).toBe(2)
  })

  it('opens the current URL privately and destroys private guests on close and route departure', async () => {
    await attachAndCommit()
    mocks.invoke.mockResolvedValueOnce({browserId: 43})
    await act(async () => (container.querySelector('[aria-label="New private page"]') as HTMLButtonElement).click())
    expect(mocks.invoke).toHaveBeenLastCalledWith({private: true})
    expect(container.textContent).toContain('Private')
    expect(sent('web-browser-navigate').at(-1)).toMatchObject({
      browserId: 43,
      url: 'https://example.com/a',
      historyIndex: undefined,
    })
    await act(async () => (container.querySelector('[aria-label="Close private page"]') as HTMLButtonElement).click())
    expect(sent('web-browser-destroy')).toEqual([{browserId: 43}])
    expect(sent('web-browser-navigate').at(-1)?.browserId).toBe(42)
    mocks.invoke.mockResolvedValueOnce({browserId: 44})
    await act(async () => (container.querySelector('[aria-label="New private page"]') as HTMLButtonElement).click())
    await act(async () => dispatch({type: 'push', route: {key: 'contacts'}}))
    expect(sent('web-browser-destroy')).toContainEqual({browserId: 44})
  })

  it('confirms before clearing data from the page menu and allows cancellation', async () => {
    await attachAndCommit()
    const openConfirm = async () => {
      await act(async () =>
        container
          .querySelector('[aria-label="Page menu"]')!
          .dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})),
      )
      await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).click())
    }
    await openConfirm()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Clear browsing data?')
    expect(mocks.clearData).not.toHaveBeenCalled()
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Cancel')!
        .click(),
    )
    expect(mocks.clearData).not.toHaveBeenCalled()
    await openConfirm()
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Clear browsing data')!
        .click(),
    )
    expect(mocks.clearData).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('shows dialog origins only for the active guest and resets on navigation', async () => {
    await attachAndCommit()
    act(() => emit({type: 'browser-dialog', browserId: 99, origin: 'https://other.example'}))
    expect(container.textContent).not.toContain('is showing dialogs')
    act(() => emit({type: 'browser-dialog', browserId: 42, origin: 'https://iframe.example'}))
    expect(container.textContent).toContain('https://iframe.example is showing dialogs')
    act(() => emit({type: 'browser-loading', browserId: 42, loading: true}))
    expect(container.textContent).not.toContain('is showing dialogs')
  })

  it('ignores stale navigation completions when a newer URL is already loading', async () => {
    await act(async () => {})
    const oldRequest = sent('web-browser-navigate').at(-1)
    act(() => dispatch({type: 'push', route: {key: 'web', url: 'https://example.com/new'}}))
    await act(async () => emit({type: 'browser-location', ...oldRequest, historyIndex: 1, title: 'Stale'}))
    expect(getState().routes[getState().routeIndex]).toEqual({key: 'web', url: 'https://example.com/new'})
  })

  it('surfaces main-frame load errors with a working retry action', async () => {
    await attachAndCommit()
    act(() =>
      emit({
        type: 'browser-load-error',
        browserId: 42,
        description: 'The web page stopped responding. Reload to try again.',
      }),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('The web page stopped responding')
    // The page view is hidden while the error panel is shown, so the panel is not covered.
    expect(sent('web-browser-bounds').at(-1)).toMatchObject({browserId: 42, visible: false})
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try again')!
    expect(sent('web-browser-control').filter((input) => input.action === 'reload')).toHaveLength(0)
    act(() => retry.click())
    expect(sent('web-browser-control').at(-1)).toEqual({browserId: 42, action: 'reload'})
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
    // Icon, then the real origin Seed draws, then the page-chosen title.
    expect(icon.nextElementSibling?.getAttribute('data-testid')).toBe('browser-origin')
    expect(icon.nextElementSibling?.textContent).toContain('example.com')
    expect(icon.nextElementSibling?.nextElementSibling?.getAttribute('role')).toBe('status')
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
      emit({
        type: 'browser-location',
        userInitiated: true,
        browserId: 42,
        url: 'https://seed.example/docs',
        title: 'Seed',
        historyIndex: 2,
      }),
    )
    expect(mocks.resolveRoute).toHaveBeenCalledWith('https://seed.example/docs', {key: 'contacts'})
  })

  it('does not resolve automatic website navigations into native routes', async () => {
    await attachAndCommit()
    mocks.resolve.mockResolvedValue({key: 'contacts'})
    await act(async () =>
      emit({type: 'browser-location', browserId: 42, url: 'https://seed.example/docs', title: 'Seed', historyIndex: 2}),
    )
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.resolveRoute).not.toHaveBeenCalled()
  })

  it('destroys the guest when disabled and leaves an external-browser fallback', async () => {
    await attachAndCommit()
    mocks.enabled = false
    act(() => dispatch({type: 'replace', route: {...getState().routes[getState().routeIndex]}}))
    expect(sent('web-browser-bounds').at(-1)).toMatchObject({browserId: 42, visible: false})
    expect(container.textContent).toContain('The experimental web browser is disabled.')
  })
})

describe('displayed origin', () => {
  it('shows the raw host and the connection state, never a page-chosen label', () => {
    expect(displayedOrigin('https://xn--pple-43d.com/login?x=1#f')).toEqual({host: 'xn--pple-43d.com', secure: true})
    expect(displayedOrigin('http://user:pw@bank.example:8080/')).toEqual({host: 'bank.example:8080', secure: false})
    expect(displayedOrigin('hm://alice/docs')).toBeNull()
    expect(displayedOrigin('not a url')).toBeNull()
  })
})
