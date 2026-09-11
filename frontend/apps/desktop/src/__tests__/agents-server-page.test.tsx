import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * An agent server's page is that server's slice of the Agents home page: the account's sessions
 * across the server's agents, and a composer that can only address those agents.
 */

const SERVER = 'https://agents.example'

const mockState = vi.hoisted(() => ({
  sessionPagesServers: null as string[] | null,
  entries: [] as Array<Record<string, any>>,
  agents: [] as Array<Record<string, any>>,
}))

vi.mock('@shm/ui/agents/models', () => ({
  getDefaultAgentServerUrl: () => null,
  useAgentAccountsSync: () => {},
  useAgentServerUrl: () => ({data: undefined}),
  useLocalAgentServerUrl: () => ({data: null}),
  useAgentWebSocketSubscription: () => ({text: ''}),
  useAgentList: () => ({data: mockState.agents, isLoading: false, isError: false, isFetching: false}),
  useAllAgentSessionPages: (serverUrls: string[]) => {
    mockState.sessionPagesServers = serverUrls
    return {
      entries: mockState.entries,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      isLoading: false,
      serverErrors: [],
    }
  },
  useCreateAgentSessionOnServer: () => ({isLoading: false, mutateAsync: vi.fn()}),
  useMessageAgentSession: () => ({isLoading: false, mutate: vi.fn()}),
  addOptimisticSessionToCaches: vi.fn(),
  addOptimisticSessionMessage: vi.fn(),
  describeAgentServer: (serverUrl: string) => serverUrl,
}))
vi.mock('@shm/ui/agents/account', () => ({useSelectedAccountId: () => 'account-1'}))
vi.mock('@shm/ui/agents/navigation', () => ({useNavigate: () => vi.fn(), useClickNavigate: () => vi.fn()}))
vi.mock('@shm/ui/agents/header', () => ({AgentBreadcrumb: () => null, SessionModelBadge: () => null}))
vi.mock('@shm/ui/agents/rich-message-composer', () => ({AgentRichMessageComposer: () => null}))
vi.mock('@shm/ui/agents/session-provider-gate', () => ({
  SessionProviderGate: () => null,
  useMissingSessionProvider: () => null,
}))
vi.mock('@shm/ui/agents/dialogs', () => ({
  CreateAgentDialog: () => null,
  ManageAgentAccountsDialog: () => null,
  ModelProvidersDialog: () => null,
}))
vi.mock('@shm/ui/universal-dialog', () => ({useAppDialog: () => ({content: null, open: vi.fn(), close: vi.fn()})}))
vi.mock('@shm/ui/tooltip', () => ({Tooltip: ({children}: {children: React.ReactNode}) => children}))
vi.mock('@shm/ui/components/dropdown-menu', () => {
  const Inline = ({children, asChild: _asChild, ...props}: any) => <div {...props}>{children}</div>
  return {
    DropdownMenu: Inline,
    DropdownMenuTrigger: Inline,
    DropdownMenuContent: Inline,
    DropdownMenuLabel: Inline,
    DropdownMenuItem: ({children, onClick}: any) => (
      <button type="button" data-testid="agent-option" onClick={onClick}>
        {children}
      </button>
    ),
  }
})
vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'agent-server', serverUrl: 'https://agents.example'}),
  useNavigation: () => ({state: {}, dispatch: vi.fn()}),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

import AgentServerPage from '@shm/ui/agents/server'

function agent(id: string, name: string) {
  return {id, status: 'idle', accessRole: 'owner', definition: {name, modelProvider: 'openai', model: 'gpt'}}
}

let container: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(<AgentServerPage />)
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.sessionPagesServers = null
  mockState.entries = []
  mockState.agents = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('agent server page', () => {
  it("lists the account's sessions on this server only, labelled with their agent", () => {
    mockState.agents = [agent('alpha', 'Alpha'), agent('bravo', 'Bravo')]
    mockState.entries = [
      {
        serverUrl: SERVER,
        session: {
          id: 's1',
          account: 'account-1',
          agentId: 'bravo',
          title: 'Plan the launch',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        },
        agent: mockState.agents[1],
      },
    ]
    render()

    expect(mockState.sessionPagesServers).toEqual([SERVER])
    expect(container.textContent).toContain('Plan the launch')
    expect(container.textContent).toContain('Bravo')
    // The separate agents list is gone; sessions are the page.
    expect(container.textContent).not.toContain('No agents on this server yet.')
  })

  it("offers only this server's agents in the composer", () => {
    mockState.agents = [agent('alpha', 'Alpha'), agent('bravo', 'Bravo')]
    render()

    const options = Array.from(container.querySelectorAll('[data-testid="agent-option"]')).map(
      (node) => node.textContent,
    )
    expect(options).toHaveLength(2)
    expect(options.join(' ')).toContain('Alpha')
    expect(options.join(' ')).toContain('Bravo')
    expect(container.textContent).toContain('No sessions on this server yet. Start one below.')
  })

  it('has nothing to compose with when the server has no agents', () => {
    render()

    expect(container.textContent).toContain('No sessions on this server yet.')
    expect(container.textContent).not.toContain('Start one below.')
    expect(container.textContent).toContain('Create an agent to start a session.')
  })
})
