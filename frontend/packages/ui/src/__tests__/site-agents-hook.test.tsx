// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The agents of the space in view, found through its mount documents.
 *
 * A reader owns none of a space's agents and collaborates on none, so asking a server to list
 * them returns nothing. The space's documents of type agent name each agent and its server; each
 * one is fetched by id, which the server answers once the agent is shared with the reader.
 */

const mockState = vi.hoisted(() => ({
  route: null as null | Record<string, unknown>,
  originHomeId: undefined as undefined | {uid: string},
  /** Mount documents the document query returns, per space uid. */
  documents: {} as Record<string, Array<{path: string; metadata: Record<string, unknown>}>>,
  documentQueries: [] as string[],
  requests: [] as {serverUrl: string; accountUid: string; agentId: string; action: string}[],
  missingAgentIds: new Set<string>(),
  sessionsByAgent: {} as Record<string, Array<Record<string, unknown>>>,
  queryDocumentsAvailable: true,
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
    action: {_: string; agentId: string; includeChildren?: boolean}
  }) => {
    mockState.requests.push({serverUrl, accountUid, agentId: action.agentId, action: action._})
    if (mockState.missingAgentIds.has(action.agentId)) throw new Error('Agent not found')
    if (action._ === 'ListSessions') {
      const all = mockState.sessionsByAgent[action.agentId] ?? []
      return {
        _: 'ListSessionsResponse',
        sessions: action.includeChildren === false ? all.filter((session) => !session.parentSessionId) : all,
        agents: [],
      }
    }
    return {
      _: 'GetAgentResponse',
      agent: {id: action.agentId, definition: {name: `Agent ${action.agentId}`}},
      sessionCount: (mockState.sessionsByAgent[action.agentId] ?? []).length,
    }
  },
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavRouteOrNull: () => mockState.route}))
vi.mock('@shm/shared/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/routing')>()),
  useUniversalClient: () => ({
    request: vi.fn(),
    queryDocuments: mockState.queryDocumentsAvailable
      ? async (request: {filter?: unknown}) => {
          const json = JSON.stringify(request.filter)
          const space = /"space":"([^"]+)"/.exec(json)?.[1] ?? ''
          mockState.documentQueries.push(json)
          return {
            documents: (mockState.documents[space] ?? []).map(
              (document) =>
                new DocumentInfo({
                  account: space,
                  path: document.path,
                  metadata: Struct.fromJson(document.metadata as never),
                  genesis: 'g',
                  version: 'v',
                }),
            ),
            nextPageToken: '',
          }
        }
      : undefined,
  }),
}))

import {Struct} from '@bufbuild/protobuf'
import {DocumentInfo} from '@shm/shared/client/grpc-types'
import {UniversalAppContext} from '@shm/shared/routing'
import {useMountedSiteAgents} from '../agents/models'

let container: HTMLDivElement
let root: Root
let latest: ReturnType<typeof useMountedSiteAgents> | null = null

function Probe({accountUid}: {accountUid: string | null}) {
  latest = useMountedSiteAgents(accountUid)
  return null
}

const AGENT = 'hm://hyper.media/agent'

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
  // Let the document query, then the GetAgent queries, resolve.
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.route = null
  mockState.originHomeId = undefined
  mockState.documents = {}
  mockState.documentQueries = []
  mockState.requests = []
  mockState.missingAgentIds = new Set()
  mockState.sessionsByAgent = {}
  mockState.queryDocumentsAvailable = true
  latest = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useMountedSiteAgents', () => {
  it('queries the space for agent documents and fetches each agent from the server its document names', async () => {
    mockState.route = {key: 'document', id: {uid: 'space-uid', path: ['about']}}
    mockState.documents['space-uid'] = [
      {path: '/second', metadata: {type: AGENT, agentServerUrl: 'https://b.example', name: 'Second'}},
      {path: '/first', metadata: {type: AGENT, agentServerUrl: 'https://a.example', name: 'First'}},
      {path: '/page', metadata: {name: 'Not an agent', agentServerUrl: 'https://c.example'}},
    ]
    await render()
    expect(mockState.documentQueries).toHaveLength(1)
    expect(mockState.documentQueries[0]).toContain('"key":"type"')
    expect(mockState.documentQueries[0]).toContain(AGENT)
    const agentRequests = mockState.requests.filter((request) => request.action === 'GetAgent')
    expect(agentRequests.map((request) => [request.serverUrl, request.agentId])).toEqual([
      ['https://a.example', 'hm://space-uid/first'],
      ['https://b.example', 'hm://space-uid/second'],
    ])
    expect(latest!.agents.map((option) => option.agent.id)).toEqual(['hm://space-uid/first', 'hm://space-uid/second'])
    expect(latest!.agents[0]!.serverUrl).toBe('https://a.example')
    // Only the servers the documents name are contacted, and only about those agents.
    expect(
      mockState.requests.every((request) => request.action === 'GetAgent' || request.action === 'ListSessions'),
    ).toBe(true)
  })

  it('leaves out an agent the reader cannot see instead of failing the list', async () => {
    mockState.route = {key: 'document', id: {uid: 'space-uid', path: []}}
    mockState.documents['space-uid'] = [
      {path: '/gone', metadata: {type: AGENT, agentServerUrl: 'https://a.example'}},
      {path: '/here', metadata: {type: AGENT, agentServerUrl: 'https://a.example'}},
    ]
    mockState.missingAgentIds = new Set(['hm://space-uid/gone'])
    await render()
    expect(latest!.agents.map((option) => option.agent.id)).toEqual(['hm://space-uid/here'])
  })

  it('uses the space hosting the app when the route names no document', async () => {
    mockState.route = {key: 'contacts'}
    mockState.originHomeId = {uid: 'origin-uid'}
    mockState.documents['origin-uid'] = [{path: '/only', metadata: {type: AGENT, agentServerUrl: 'https://a.example'}}]
    await render()
    expect(latest!.agents.map((option) => option.agent.id)).toEqual(['hm://origin-uid/only'])
  })

  it("carries each agent's top-level sessions along, since no listing shows a reader those", async () => {
    mockState.route = {key: 'document', id: {uid: 'space-uid', path: []}}
    mockState.documents['space-uid'] = [{path: '/docs', metadata: {type: AGENT, agentServerUrl: 'https://a.example'}}]
    const docs = 'hm://space-uid/docs'
    mockState.sessionsByAgent = {
      [docs]: [
        {id: 's-2', agentId: docs, title: 'Latest', updatedAt: 200},
        {id: 's-child', agentId: docs, title: 'Child', parentSessionId: 's-2', updatedAt: 150},
        {id: 's-1', agentId: docs, title: 'First', updatedAt: 100},
      ],
    }
    await render()
    expect(latest!.sessions.map((entry) => entry.session.id)).toEqual(['s-2', 's-1'])
    expect(latest!.sessions[0]!.serverUrl).toBe('https://a.example')
    expect(latest!.sessions[0]!.agent?.id).toBe(docs)
  })

  it('fetches nothing without mount documents, an account to sign with, or a document query', async () => {
    mockState.route = {key: 'document', id: {uid: 'space-uid', path: []}}
    await render()
    expect(latest!.agents).toEqual([])
    expect(latest!.isLoading).toBe(false)

    mockState.documents['space-uid'] = [{path: '/only', metadata: {type: AGENT, agentServerUrl: 'https://a.example'}}]
    await render(null)
    expect(latest!.agents).toEqual([])
    expect(mockState.requests).toEqual([])

    mockState.queryDocumentsAvailable = false
    await render()
    expect(latest!.agents).toEqual([])
    expect(mockState.requests).toEqual([])
  })
})
