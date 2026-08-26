import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The Agents page must present the desktop-managed server as a named place rather than a URL with
 * an uptime indicator: it is part of the app, always present, and its port is assigned at startup.
 */

const mockState = vi.hoisted(() => ({
  serverUrls: ['http://localhost:3051', 'https://agentic.seed.hyper.media'] as string[],
  localServerUrl: 'http://localhost:3051' as string | null,
  healths: [] as Array<{isLoading: boolean; isError: boolean; data?: {uptime: number}}>,
  selectedAccountId: 'account-1' as string | null,
  accountIds: ['account-1'] as string[],
  invites: [] as Array<{
    agentId: string
    agentName: string
    ownerAccountId: string
    role: 'reader' | 'writer'
    createdAt: number
    updatedAt: number
  }>,
}))

vi.mock('@shm/ui/agents/models', () => ({
  LOCAL_AGENT_SERVER_LABEL: 'Local Agents',
  isLocalAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    !!localServerUrl && serverUrl === localServerUrl,
  useAgentServerUrls: () => ({data: mockState.serverUrls}),
  useLocalAgentServerUrl: () => ({data: mockState.localServerUrl}),
  useAgentServerHealths: () => mockState.healths,
  useAgentLists: () => mockState.serverUrls.map(() => ({data: [], isFetching: false, isError: false})),
  useSpaceAgents: () => ({agents: [], isLoading: false}),
  useAgentInviteLists: () =>
    mockState.serverUrls.map((_, index) => ({
      data: index === 0 ? mockState.invites : [],
      isFetching: false,
      isError: false,
    })),
  useAcceptAgentInvite: () => ({isLoading: false, mutate: vi.fn()}),
  useDeclineAgentInvite: () => ({isLoading: false, mutate: vi.fn()}),
  useAgentWebSocketSubscription: () => ({text: ''}),
  useAgentAccountsSync: () => {},
}))

vi.mock('@shm/ui/agents/account', () => ({useSelectedAccountId: () => mockState.selectedAccountId}))
vi.mock('@/selected-account', () => ({useSelectedAccountId: () => mockState.selectedAccountId}))
// The signed-out state pulls in the auth dialog, whose real module graph reaches the editor
// package; only its hook surface matters here.
vi.mock('@/components/desktop-auth-dialog', () => ({
  useDesktopAuthDialog: () => ({content: null, open: vi.fn(), close: vi.fn()}),
}))
vi.mock('@/models/daemon', () => ({useMyAccountIds: () => ({data: mockState.accountIds})}))
vi.mock('@shm/ui/agents/navigation', () => ({
  useNavigate: () => vi.fn(),
  useClickNavigate: () => vi.fn(),
  useOpenUrl: () => vi.fn(),
  resolveHypermediaRoute: () => null,
}))
vi.mock('@shm/ui/agents/platform', () => ({
  getAgentsPlatform: () => ({
    useSignInPrompt: () => ({hasAccounts: !!mockState.accountIds.length, signIn: vi.fn(), dialog: null}),
  }),
  setAgentsPlatform: vi.fn(),
}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))
vi.mock('@shm/ui/agents/dialogs', () => ({
  CreateAgentDialog: () => null,
  ManageAgentAccountsDialog: () => null,
  ModelProvidersDialog: () => null,
}))
vi.mock('@shm/ui/universal-dialog', () => ({
  useAppDialog: () => ({content: null, open: vi.fn(), close: vi.fn()}),
}))

// Radix tooltips need a provider the app shell supplies; render children directly instead.
vi.mock('@shm/ui/tooltip', () => ({
  Tooltip: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock('@shm/shared/utils/navigation', () => {
  const React = require('react')
  const NavContext = React.createContext(null)
  return {
    useNavRoute: () => ({key: 'agents'}),
    useNavigation: () => ({state: {}, dispatch: vi.fn()}),
    NavContextProvider: NavContext.Provider,
    navStateReducer: (state: any) => state,
    getRouteKey: () => 'agents',
    appRouteOfId: () => undefined,
    isHttpUrl: () => false,
    useNavigate: () => vi.fn(),
    useNavigationState: () => ({}),
    useNavigationDispatch: () => vi.fn(),
    useRouteDocId: () => null,
  }
})

import AgentsListPage from '@shm/ui/agents/list'

function renderList() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<AgentsListPage />)
  })
  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

/** Status dots are the only fully-rounded 2.5-size spans in the server rows. */
function statusDots(container: HTMLElement) {
  return Array.from(container.querySelectorAll('span.rounded-full.size-2\\.5, span.size-2\\.5.rounded-full'))
}

describe('agents list — local server presentation', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.serverUrls = ['http://localhost:3051', 'https://agentic.seed.hyper.media']
    mockState.localServerUrl = 'http://localhost:3051'
    mockState.healths = [
      {isLoading: false, isError: false, data: {uptime: 60}},
      {isLoading: false, isError: false, data: {uptime: 60}},
    ]
    mockState.selectedAccountId = 'account-1'
    mockState.accountIds = ['account-1']
    mockState.invites = []
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows pending agent invitations with their role and actions', () => {
    mockState.invites = [
      {
        agentId: 'shared-agent',
        agentName: 'Research partner',
        ownerAccountId: 'z6MkOwnerAccount',
        role: 'writer',
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const {container, root} = renderList()

    expect(container.textContent).toContain('Invites')
    expect(container.textContent).toContain('Research partner')
    expect(container.textContent).toContain('Write collaborator')
    expect(container.textContent).toContain('Accept')
    expect(container.textContent).toContain('Decline')

    cleanupRendered(root, container)
  })

  it('names the local server instead of showing its URL', () => {
    const {container, root} = renderList()

    expect(container.textContent).toContain('Local Agents')
    // The port is assigned at startup, so it is never presented as an address.
    expect(container.textContent).not.toContain('localhost:3051')
    // Remote servers keep their host.
    expect(container.textContent).toContain('agentic.seed.hyper.media')

    cleanupRendered(root, container)
  })

  it('shows no status dot for a healthy local server, but keeps one for remotes', () => {
    const {container, root} = renderList()

    const dots = statusDots(container)
    expect(dots).toHaveLength(1)
    expect(dots[0]!.className).toContain('bg-green-500')

    cleanupRendered(root, container)
  })

  it('still surfaces a failing local server', () => {
    // Suppressing the "online" dot must not hide a real failure.
    mockState.healths = [
      {isLoading: false, isError: true},
      {isLoading: false, isError: false, data: {uptime: 60}},
    ]

    const {container, root} = renderList()

    const dots = statusDots(container)
    expect(dots).toHaveLength(2)
    expect(dots.some((dot) => dot.className.includes('bg-destructive'))).toBe(true)

    cleanupRendered(root, container)
  })

  it('shows a normal host row when there is no local server', () => {
    mockState.localServerUrl = null

    const {container, root} = renderList()

    expect(container.textContent).not.toContain('Local Agents')
    expect(statusDots(container)).toHaveLength(2)

    cleanupRendered(root, container)
  })
})

describe('agents list — no active account', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.serverUrls = ['http://localhost:3051', 'https://agentic.seed.hyper.media']
    mockState.localServerUrl = 'http://localhost:3051'
    mockState.healths = [
      {isLoading: false, isError: false, data: {uptime: 60}},
      {isLoading: false, isError: false, data: {uptime: 60}},
    ]
    mockState.selectedAccountId = null
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  // Agent servers reject unauthenticated requests, so without an active account the page must not
  // present servers it cannot talk to.
  it('hides servers and asks the user to sign in when no accounts exist', () => {
    mockState.accountIds = []

    const {container, root} = renderList()

    expect(container.textContent).toContain('Sign in to use agents')
    expect(container.textContent).toContain('Sign in or create an account')
    expect(container.textContent).not.toContain('Local Agents')
    expect(container.textContent).not.toContain('agentic.seed.hyper.media')
    expect(container.textContent).not.toContain('Agent Servers')

    cleanupRendered(root, container)
  })

  it('asks the user to select an account when accounts exist but none is active', () => {
    mockState.accountIds = ['account-1']

    const {container, root} = renderList()

    expect(container.textContent).toContain('Select an account')
    expect(container.textContent).not.toContain('Local Agents')

    cleanupRendered(root, container)
  })
})
