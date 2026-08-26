// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The agents a space publishes to its readers.
 *
 * A reader owns none of a space's agents and collaborates on none, so asking the server to list
 * them returns nothing. Each published agent is fetched by the id the space named instead — which
 * the server answers for any signed account once the agent is public-read.
 */

const mockState = vi.hoisted(() => ({
  route: null as null | Record<string, unknown>,
  originHomeId: undefined as undefined | {uid: string},
  homeMetadata: {} as Record<string, unknown>,
  requests: [] as {serverUrl: string; accountUid: string; agentId: string}[],
  missingAgentIds: new Set<string>(),
}))

vi.mock('../agents/platform', () => ({
  getAgentsPlatform: () => ({
    defaultServerUrl: () => null,
    getSetting: async () => null,
    setSetting: vi.fn(),
    getLocalServerUrl: async () => null,
  }),
  setAgentsPlatform: vi.fn(),
}))
vi.mock('../agents/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendAgentAction: async ({
    serverUrl,
    accountUid,
    action,
  }: {
    serverUrl: string
    accountUid: string
    action: {_: string; agentId: string}
  }) => {
    mockState.requests.push({serverUrl, accountUid, agentId: action.agentId})
    if (mockState.missingAgentIds.has(action.agentId)) throw new Error('Agent not found')
    return {
      _: 'GetAgentResponse',
      agent: {id: action.agentId, definition: {name: `Agent ${action.agentId}`}},
      sessions: [],
    }
  },
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavRouteOrNull: () => mockState.route}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: {uid: string} | undefined) =>
    id ? {data: {type: 'document', document: {metadata: mockState.homeMetadata}}} : {data: undefined},
}))

import {UniversalAppContext} from '@shm/shared/routing'
import {useSpaceAgents} from '../agents/models'

let container: HTMLDivElement
let root: Root
let latest: ReturnType<typeof useSpaceAgents> | null = null

function Probe({accountUid}: {accountUid: string | null}) {
  latest = useSpaceAgents(accountUid)
  return null
}

async function render(accountUid: string | null = 'reader-uid') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <UniversalAppContext.Provider value={{originHomeId: mockState.originHomeId, openUrl: () => {}} as any}>
          <Probe accountUid={accountUid} />
        </UniversalAppContext.Provider>
      </QueryClientProvider>,
    )
  })
  // Let the GetAgent queries resolve.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.route = null
  mockState.originHomeId = undefined
  mockState.homeMetadata = {}
  mockState.requests = []
  mockState.missingAgentIds = new Set()
  latest = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useSpaceAgents', () => {
  it('fetches each published agent by id from the space server, in published order', async () => {
    mockState.route = {key: 'document', id: {uid: 'space-uid', path: ['about']}}
    mockState.homeMetadata = {
      agentServerUrl: 'https://agents.space.example/',
      spaceAgents: {second: 1, first: 0},
    }
    await render()
    expect(mockState.requests.map((request) => request.agentId).sort()).toEqual(['first', 'second'])
    expect(mockState.requests[0]!.serverUrl).toBe('https://agents.space.example')
    expect(latest!.agents.map((option) => option.agent.id)).toEqual(['first', 'second'])
    expect(latest!.agents[0]!.serverUrl).toBe('https://agents.space.example')
  })

  it('drops an agent that no longer loads instead of failing the list', async () => {
    // A space naming an agent that was since deleted or made private should offer one fewer agent,
    // not an error where a chat belongs.
    mockState.route = {key: 'document', id: {uid: 'space-uid', path: []}}
    mockState.homeMetadata = {
      agentServerUrl: 'https://agents.space.example',
      spaceAgents: {gone: 0, here: 1},
    }
    mockState.missingAgentIds = new Set(['gone'])
    await render()
    expect(latest!.agents.map((option) => option.agent.id)).toEqual(['here'])
  })

  it('uses the space hosting the app when the route names no document', async () => {
    // The web app's own /hm/agents pages are served by a space but carry no document route.
    mockState.route = {key: 'agents'}
    mockState.originHomeId = {uid: 'origin-uid'}
    mockState.homeMetadata = {agentServerUrl: 'https://agents.space.example', spaceAgents: {only: 0}}
    await render()
    expect(latest!.agents.map((option) => option.agent.id)).toEqual(['only'])
  })

  it('fetches nothing without a space server, a published list, or an account to sign with', async () => {
    mockState.route = {key: 'document', id: {uid: 'space-uid', path: []}}
    mockState.homeMetadata = {spaceAgents: {orphan: 0}}
    await render()
    expect(latest!.agents).toEqual([])

    mockState.homeMetadata = {agentServerUrl: 'https://agents.space.example'}
    await render()
    expect(latest!.agents).toEqual([])

    mockState.homeMetadata = {agentServerUrl: 'https://agents.space.example', spaceAgents: {only: 0}}
    await render(null)
    expect(latest!.agents).toEqual([])
    expect(mockState.requests).toEqual([])
  })
})
