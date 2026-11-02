import React from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {NavContextProvider, navStateReducer, type NavAction, type NavState} from '@shm/shared/utils/navigation'
import {streamSelector, writeableStateStream} from '@shm/shared/utils/stream'
import {TooltipProvider} from '@shm/ui/tooltip'

vi.mock('@/models/daemon', () => ({
  useMyAccountIds: () => ({data: ['account-1', 'account-2']}),
  useVaultStatus: () => ({data: {}}),
  useForceVaultSync: () => ({}),
  useLogout: () => ({}),
}))
vi.mock('@/models/experiments', () => ({useExperiments: () => ({data: {}})}))
vi.mock('@/utils/navigation-container', () => ({queryDevtoolsOpen: undefined, RouteDialog: () => null}))
vi.mock('@shm/ui/universal-dialog', () => ({useAppDialog: () => ({})}))
vi.mock('../create-account', () => ({useCreateAccountDialog: () => ({})}))
vi.mock('../desktop-auth-dialog', () => ({useDesktopAuthDialog: () => ({})}))
vi.mock('@/selected-account', () => ({
  useSelectedAccountId: () => 'account-1',
  useSelectedAccount: () => ({metadata: {name: 'account-1'}}),
}))
vi.mock('@shm/ui/hm-icon', () => ({HMIcon: () => null}))
vi.mock('@/trpc', () => ({client: {}}))

vi.mock('@shm/shared/models/entity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/entity')>()),
  useAccounts: (uids: string[]) => uids.map((uid) => ({data: {id: hmId(uid), metadata: {name: uid}}})),
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
vi.mock('../bookmarks-popover', () => ({}))
vi.mock('../copy-reference-button', () => ({}))
vi.mock('../publish-site', () => ({}))
vi.mock('../search-input', () => ({}))
vi.mock('@shm/ui/activity-panel', () => ({}))
vi.mock('@shm/ui/agents/activity', () => ({}))

import {AccountProfileButton} from '../titlebar-common'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
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
  const header = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(
    (button) => button.textContent === 'account-1',
  )!
  act(() => header.click())
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] button')).find(
    (element) => element.textContent === uid,
  )
  expect(option).toBeDefined()
  act(() => option!.click())
}

describe('titlebar account switching', () => {
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
    const header = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(
      (button) => button.textContent === 'account-1',
    )!
    act(() => header.click())
    expect(state.get().routes).toEqual([{key: 'document', id: hmId('site-1')}])
    expect(state.get().routeIndex).toBe(0)
  })
})
