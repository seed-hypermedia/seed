import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The agent-scoped sidebar layout.
 *
 * The sidebar must open directly into an agent context — top dropdown picks the agent, session
 * dropdown picks within that context, and switching agents swaps the visible sessions. This
 * replaced a per-chat "choose an agent" dialog whose friction was the point of removing it, so
 * these tests guard that no dialog is required anywhere in that flow.
 */

const LOCAL = 'http://localhost:3050'
const REMOTE = 'https://agentic.seed.hyper.media'

const mockState = vi.hoisted(() => ({
  serverUrls: [] as string[],
  agentLists: [] as Array<{data: Array<{id: string; definition: {name: string; model: string}}>}>,
  sessionEntries: [] as Array<{serverUrl: string; session: Record<string, unknown>}>,
}))

vi.mock('@/models/agents', () => ({
  LOCAL_AGENT_SERVER_LABEL: 'Local Agents',
  isLocalAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    !!localServerUrl && serverUrl === localServerUrl,
  describeAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    localServerUrl && serverUrl === localServerUrl ? 'Local Agents' : new URL(serverUrl).host,
  addOptimisticSessionMessage: vi.fn(),
  removeOptimisticSessionFromLists: vi.fn(),
  useAgentLists: () => mockState.agentLists,
  useAgentServerUrls: () => ({data: mockState.serverUrls, isSuccess: true, isLoading: false}),
  useAgentSession: () => ({data: undefined}),
  useAgentWebSocketSubscription: () => ({text: ''}),
  useAllAgentSessions: () => ({entries: mockState.sessionEntries, isLoading: false, isError: false}),
  useCreateAgentSessionOnServer: () => ({mutateAsync: vi.fn()}),
  useDeleteAgentSession: () => ({mutate: vi.fn()}),
  useLocalAgentServerUrl: () => ({data: LOCAL}),
  useMessageAgentSession: () => ({mutate: vi.fn()}),
  useStopAgentSession: () => ({mutate: vi.fn()}),
}))

vi.mock('@/selected-account', () => ({useSelectedAccountId: () => 'account-1'}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => vi.fn()}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: undefined})}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

vi.mock('@shm/shared/utils/navigation', () => {
  const React = require('react')
  const NavContext = React.createContext(null)
  return {
    useNavRoute: () => ({key: 'library'}),
    useNavigation: () => ({state: {}, dispatch: vi.fn()}),
    NavContextProvider: NavContext.Provider,
    navStateReducer: (state: any) => state,
    getRouteKey: () => 'library',
    appRouteOfId: () => undefined,
    isHttpUrl: () => false,
    useNavigate: () => vi.fn(),
    useNavigationState: () => ({}),
    useNavigationDispatch: () => vi.fn(),
    useRouteDocId: () => null,
  }
})

import {AssistantPanel} from '../components/assistant-panel'

let root: Root
let container: HTMLDivElement

function clickText(text: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find(
    (element) => element.textContent?.includes(text),
  )
  expect(button, `button containing "${text}"`).toBeTruthy()
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  mockState.serverUrls = [LOCAL, REMOTE]
  mockState.agentLists = [
    {data: [{id: 'assistant', definition: {name: 'Assistant', model: 'claude-sonnet-5'}}]},
    {data: [{id: 'researcher', definition: {name: 'Researcher', model: 'gpt-5'}}]},
  ]
  mockState.sessionEntries = [
    {serverUrl: REMOTE, session: {id: 's-r1', agentId: 'researcher', title: 'Web research', updatedAt: 400}},
    {serverUrl: LOCAL, session: {id: 's-a1', agentId: 'assistant', title: 'Doc questions', updatedAt: 300}},
  ]
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('assistant sidebar agent context', () => {
  it('opens straight into the default agent context with its newest session — no dialog', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    // Local server is first, so its agent is the default context.
    expect(document.body.textContent).toContain('Assistant')
    expect(document.body.textContent).toContain('Doc questions')
    // The other agent's session must not leak into this context.
    expect(document.body.textContent).not.toContain('Web research')
  })

  it('switches agent context from the top dropdown, grouped by server', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })

    clickText('Assistant')
    expect(document.body.textContent).toContain('Local Agents')
    expect(document.body.textContent).toContain('agentic.seed.hyper.media')

    clickText('Researcher')
    // Context switched: the researcher's newest session is now active.
    expect(document.body.textContent).toContain('Web research')
    expect(document.body.textContent).not.toContain('Doc questions')
  })

  it('starts a new chat as a draft in the current context, ready to type', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })

    const newChat = Array.from(document.body.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === 'New chat',
    )
    act(() => {
      newChat!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(document.body.textContent).toContain('New chat')
    expect(document.body.textContent).toContain('Send a message to start chatting with Assistant')
  })

  it('offers session options in a menu on the session row, not a dedicated row', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    const options = Array.from(document.body.querySelectorAll('button')).filter(
      (element) => element.getAttribute('title') === 'Chat options',
    )
    expect(options).toHaveLength(1)
  })
})
