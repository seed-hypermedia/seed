import React from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {NavContextProvider, navStateReducer, type NavAction, type NavState} from '@shm/shared/utils/navigation'
import {streamSelector, writeableStateStream} from '@shm/shared/utils/stream'
import {TooltipProvider} from '@shm/ui/tooltip'

const accountFixture = vi.hoisted(() => ({
  ids: ['account-1', 'account-2', 'account-3'],
  names: {} as Record<string, string>,
}))

vi.mock('@/models/daemon', () => ({
  useMyAccountIds: () => ({data: accountFixture.ids}),
  useVaultStatus: () => ({data: {}}),
  useForceVaultSync: () => ({}),
  useLogout: () => ({}),
  useVaultEmail: () => ({}),
}))
vi.mock('@/models/experiments', () => ({useExperiments: () => ({data: {}})}))
vi.mock('@/utils/navigation-container', () => ({queryDevtoolsOpen: undefined, RouteDialog: () => null}))
vi.mock('@shm/ui/universal-dialog', () => ({useAppDialog: () => ({})}))
vi.mock('../create-account', () => ({useCreateAccountDialog: () => ({})}))
vi.mock('../desktop-auth-dialog', () => ({useDesktopAuthDialog: () => ({})}))
vi.mock('@/selected-account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/selected-account')>()),
  useSelectedAccountId: () => 'account-1',
  useSelectedAccount: () => ({metadata: {name: 'account-1'}}),
}))
vi.mock('@shm/ui/hm-icon', () => ({HMIcon: () => null}))
vi.mock('@/trpc', () => ({client: {}}))

vi.mock('@shm/shared/models/entity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/entity')>()),
  useResource: () => ({data: {type: 'document', document: {metadata: {name: 'My space'}}}}),
  useAccounts: (uids: string[]) =>
    uids.map((uid) => ({data: {id: hmId(uid), metadata: {name: accountFixture.names[uid] || uid}}})),
}))
vi.mock('@/app-context', () => ({useIPC: () => ({invoke: vi.fn()})}))
vi.mock('@/telemetry', () => ({reportTelemetry: vi.fn(), TelemetryStage: {}, telemetryKeyForRoute: vi.fn()}))
vi.mock('@shm/ui/highlight-context', () => ({useHighlighter: () => () => ({})}))
vi.mock('@shm/ui/account-avatar', () => ({AccountAvatar: () => null}))
vi.mock('../onboarding', () => ({dispatchOnboardingDialog: vi.fn()}))

vi.mock('@/models/drafts', () => ({}))
vi.mock('@/models/notification-inbox', () => ({}))
vi.mock('@shm/ui/agents/models', () => ({}))
vi.mock('../bookmarking', () => ({}))
vi.mock('../bookmarks-panel', () => ({useBookmarksPanel: () => ({open: () => {}})}))
vi.mock('../create-space-dialog', () => ({useCreateSpaceDialog: () => ({open: () => {}})}))
vi.mock('@shm/shared/models/capabilities', () => ({
  useSelectedAccountCapability: () => null,
  useIsSiteOwner: () => ({isSiteOwner: false}),
}))
vi.mock('@shm/shared/models/contacts', () => ({useSelectedAccountContacts: () => ({data: []})}))
vi.mock('../copy-reference-button', () => ({}))
vi.mock('../publish-site', () => ({}))
vi.mock('../search-input', () => ({}))
vi.mock('@shm/ui/activity-panel', () => ({}))
vi.mock('@shm/ui/agents/activity', () => ({}))

import {AccountProfileButton} from '../titlebar-common'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  accountFixture.names = {}
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderAccountMenu() {
  const [setState, state] = writeableStateStream<NavState>({
    routes: [{key: 'document', id: hmId('site-1')}],
    routeIndex: 0,
    lastAction: 'push',
    selectedIdentity: 'account-1',
  })
  const dispatch = (action: NavAction) => setState((previous) => navStateReducer(previous, action))
  const selectedIdentity = streamSelector(state, (value) => value.selectedIdentity ?? null)
  act(() =>
    root.render(
      <NavContextProvider value={{state, dispatch}}>
        <UniversalAppProvider
          openRoute={() => {}}
          openUrl={() => {}}
          universalClient={{} as any}
          selectedIdentity={selectedIdentity}
          setSelectedIdentity={(value) => dispatch({type: 'selectedIdentity', value})}
        >
          <TooltipProvider>
            <AccountProfileButton />
          </TooltipProvider>
        </UniversalAppProvider>
      </NavContextProvider>,
    ),
  )
  return state
}

function selectAccount(uid: string) {
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')!
      .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
  )
  const header = document.querySelector<HTMLElement>('[aria-label="Switch account"]')!
  act(() => header.dispatchEvent(new MouseEvent('pointerdown', {button: 0, bubbles: true})))
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => element.textContent === uid,
  )
  expect(option).toBeDefined()
  act(() => option!.click())
}

describe('titlebar account switching', () => {
  it('does not open on hover but still opens on click', () => {
    renderAccountMenu()
    act(() =>
      container
        .querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')!
        .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
    )
    const header = document.querySelector<HTMLElement>('[aria-label="Switch account"]')!
    vi.useFakeTimers()
    try {
      act(() => {
        const move = new Event('pointermove', {bubbles: true, cancelable: true})
        Object.defineProperty(move, 'pointerType', {value: 'mouse'})
        header.dispatchEvent(move)
        vi.advanceTimersByTime(1000)
      })
      expect(header.getAttribute('aria-expanded')).toBe('false')
      act(() => header.dispatchEvent(new MouseEvent('pointerdown', {button: 0, bubbles: true})))
      expect(header.getAttribute('aria-expanded')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the account list open while the pointer crosses another parent menu item', () => {
    renderAccountMenu()
    act(() =>
      container
        .querySelector<HTMLElement>('[aria-label="Account menu"]')!
        .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
    )
    const header = document.querySelector<HTMLElement>('[aria-label="Switch account"]')!
    act(() => header.dispatchEvent(new MouseEvent('pointerdown', {button: 0, bubbles: true})))
    const profile = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'My profile',
    )!
    act(() => {
      const move = new Event('pointermove', {bubbles: true, cancelable: true})
      Object.defineProperty(move, 'pointerType', {value: 'mouse'})
      profile.dispatchEvent(move)
    })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2)
  })

  it('sorts unused accounts by name and persists the last selected account', () => {
    accountFixture.names = {'account-2': 'Zebra', 'account-3': 'Alpha'}
    const state = renderAccountMenu()
    act(() =>
      container
        .querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')!
        .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
    )
    act(() =>
      document
        .querySelector<HTMLElement>('[aria-label="Switch account"]')!
        .dispatchEvent(new MouseEvent('pointerdown', {button: 0, bubbles: true})),
    )
    let items = Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Accounts"] [role="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual(['Alpha', 'Zebra', 'Create account'])
    act(() => items[1]!.click())
    expect(state.get().selectedIdentity).toBe('account-2')
    expect(JSON.parse(localStorage.getItem('seed.account-selection-history')!)[0]).toBe('account-2')
    act(() => root.unmount())
    root = createRoot(container)
    renderAccountMenu()
    act(() =>
      container
        .querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')!
        .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
    )
    act(() =>
      document
        .querySelector<HTMLElement>('[aria-label="Switch account"]')!
        .dispatchEvent(new MouseEvent('pointerdown', {button: 0, bubbles: true})),
    )
    items = Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Accounts"] [role="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual(['Zebra', 'Alpha', 'Create account'])
  })

  it('ignores malformed saved history and keeps accounts selectable', () => {
    localStorage.setItem('seed.account-selection-history', '{broken')
    const state = renderAccountMenu()
    selectAccount('account-2')
    expect(state.get().selectedIdentity).toBe('account-2')
  })

  it('opens a nested account dropdown with the keyboard and returns to the header', async () => {
    const state = renderAccountMenu()
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')!
        .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
    )
    const header = document.querySelector<HTMLElement>('[aria-label="Switch account"]')!
    expect(header.getAttribute('role')).toBe('menuitem')
    act(() => header.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})))
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2)
    const submenu = document.querySelector<HTMLElement>('[aria-label="Accounts"]')!
    act(() => submenu.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})))
    await act(async () => {})
    expect(header.getAttribute('aria-expanded')).toBe('false')
    await vi.waitFor(() => expect(document.activeElement).toBe(header))
    expect(state.get().routes).toEqual([{key: 'document', id: hmId('site-1')}])
  })

  it('opens Drafts from the account menu without changing identity', () => {
    const state = renderAccountMenu()
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')!
        .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
    )
    const drafts = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'Drafts',
    )!
    act(() => drafts.click())
    expect(state.get().routes[state.get().routeIndex]).toEqual({key: 'drafts'})
    expect(state.get().selectedIdentity).toBe('account-1')
  })

  it('opens the new account home when switching from another site', () => {
    const state = renderAccountMenu()
    selectAccount('account-2')
    expect(state.get().selectedIdentity).toBe('account-2')
    expect(state.get().routes[state.get().routeIndex]).toEqual({key: 'document', id: hmId('account-2')})
  })

  it('keeps the current page when opening the account switcher', () => {
    const state = renderAccountMenu()
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')!
        .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
    )
    const header = document.querySelector<HTMLElement>('[aria-label="Switch account"]')!
    act(() => header.dispatchEvent(new MouseEvent('pointerdown', {button: 0, bubbles: true})))
    expect(state.get().routes).toEqual([{key: 'document', id: hmId('site-1')}])
    expect(state.get().routeIndex).toBe(0)
  })
})
