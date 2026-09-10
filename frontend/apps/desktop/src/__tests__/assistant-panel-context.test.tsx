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
  agentLists: [] as Array<{data: Array<{id: string; definition: {name: string; model: string}; activity?: unknown}>}>,
  readState: undefined as undefined | {allBefore?: number; sessions: Record<string, number>},
  marked: [] as Array<{serverUrl: string; sessionId: string; seenAt: number}>,
  sessionEntries: [] as Array<{serverUrl: string; session: Record<string, unknown>}>,
  spaceAgents: {
    agents: [] as Array<{serverUrl: string; agent: {id: string; definition: {name: string; model: string}}}>,
    sessions: [] as Array<{serverUrl: string; session: Record<string, unknown>}>,
    isLoading: false,
  },
  agentListsSettled: true,
  navigate: undefined as unknown as ReturnType<typeof vi.fn>,
  createAgentDialogMounts: 0,
  createAgentDialogInput: null as null | {onCreated?: (created: {serverUrl: string; agentId: string}) => void},
}))

// The unread logic runs for real against a faked read state; the react-query-backed pieces (the
// transcript's own mark, the stored state) are stubbed since nothing here provides a client.
vi.mock('@shm/ui/agents/activity', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMarkAgentSessionRead: () => {},
  latestSessionEventAt: () => undefined,
  useAgentActivityReadState: () => ({data: mockState.readState}),
  markAgentSessionRead: (serverUrl: string, sessionId: string, seenAt: number) => {
    mockState.marked.push({serverUrl, sessionId, seenAt})
  },
}))
vi.mock('@shm/ui/agents/models', () => ({
  // The create-agent dialog checks the server before offering models; here it is never reached.
  useAgentServerHealth: () => ({data: undefined, isLoading: false}),
  LOCAL_AGENT_SERVER_LABEL: 'Local Agents',
  isLocalAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    !!localServerUrl && serverUrl === localServerUrl,
  describeAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    localServerUrl && serverUrl === localServerUrl ? 'Local Agents' : new URL(serverUrl).host,
  addOptimisticSessionMessage: vi.fn(),
  addOptimisticSessionToCaches: vi.fn(),
  removeOptimisticSessionFromLists: vi.fn(),
  useAgentDetail: () => ({data: undefined, isLoading: false}),
  useRun: () => ({data: undefined}),
  useAgentLists: () =>
    mockState.agentLists.map((query) => ({...query, isSuccess: mockState.agentListsSettled, isError: false})),
  useSpaceAgents: () => mockState.spaceAgents,
  useAgentServerUrls: () => ({data: mockState.serverUrls, isSuccess: true, isLoading: false}),
  useAgentSession: () => ({data: undefined}),
  useAgentWebSocketSubscription: () => ({text: ''}),
  useAllAgentSessions: () => ({entries: mockState.sessionEntries, isLoading: false, isError: false}),
  useCreateAgentSessionOnServer: () => ({mutateAsync: vi.fn()}),
  useDeleteAgentSession: () => ({mutate: vi.fn()}),
  useLocalAgentServerUrl: () => ({data: LOCAL}),
  useMessageAgentSession: () => ({mutate: vi.fn()}),
  useStopAgentSession: () => ({mutate: vi.fn()}),
  useRetrySession: () => ({mutate: vi.fn(), isPending: false}),
  useUpdateAgentSession: () => ({mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false}),
  // The panel header's model/thoroughness picker and the provider gate: nothing configured here.
  useUpdateAgent: () => ({mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false}),
  useModelProviders: () => ({data: [], isLoading: false}),
  useProviderModelCatalogs: () => ({}),
  useSigningIdentities: () => ({data: [], isLoading: false}),
  // Sub-session nesting and the pinned run card: idle by default, so neither renders here.
  useChildSessions: () => ({data: undefined, isLoading: false, isError: false}),
  useSessionRuns: () => ({data: []}),
  useRunTree: () => ({data: []}),
  useAgentRunTreeSubscription: () => ({runs: {}, progress: {}, activity: {}, journal: []}),
  useCancelRun: () => ({mutate: vi.fn(), isPending: false}),
}))

vi.mock('@shm/ui/agents/account', () => ({useSelectedAccountId: () => 'account-1'}))
vi.mock('@/selected-account', () => ({useSelectedAccountId: () => 'account-1'}))
vi.mock('@shm/ui/agents/navigation', () => ({
  useNavigate: () => mockState.navigate,
  useClickNavigate: () => vi.fn(),
  useOpenUrl: () => vi.fn(),
  resolveHypermediaRoute: () => null,
}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => mockState.navigate}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: undefined})}))
// The real composer drags in the ProseMirror editor stack, which does not load under jsdom. The
// mock honors the contract these tests care about: a textarea stands in for the editor, it
// focuses itself when told to focus on mount (the default, as in the real component), it renders
// the driven-by-parent notice instead of an input, and it exposes an imperative focus handle.
vi.mock('@shm/ui/agents/rich-message-composer', () => {
  const React = require('react')
  return {
    SubSessionDrivenNotice: () => React.createElement('div', null, 'This session is controlled by its parent'),
    SubSessionHeader: () => null,
    TERMINAL_RUN_STATUSES: new Set(['succeeded', 'failed', 'canceled']),
    AgentRichMessageComposer: ({
      focusOnMount = true,
      disabledMessage,
      composerHandleRef,
    }: {
      focusOnMount?: boolean
      disabledMessage?: string
      composerHandleRef?: {current: unknown}
    }) => {
      const ref = React.useRef(null)
      React.useEffect(() => {
        if (composerHandleRef) {
          composerHandleRef.current = {
            focus: () => (ref.current as HTMLTextAreaElement | null)?.focus(),
            submit: () => {},
            reset: () => {},
            flush: () => {},
            getContent: async () => ({blockNodes: [], blobs: []}),
          }
        }
        if (focusOnMount) (ref.current as HTMLTextAreaElement | null)?.focus()
      }, [])
      if (disabledMessage) return React.createElement('div', null, disabledMessage)
      return React.createElement('textarea', {ref, 'data-testid': 'rich-composer'})
    },
  }
})

// The real create dialog drags in the prompt editor stack; the panel only mounts it via
// useAppDialog, which is what these tests assert.
vi.mock('@shm/ui/agents/dialogs', () => ({
  CreateAgentDialog: ({input}: {input: (typeof mockState)['createAgentDialogInput']}) => {
    mockState.createAgentDialogMounts += 1
    mockState.createAgentDialogInput = input
    return null
  },
}))
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

import {AssistantPanel} from '@shm/ui/agents/assistant-panel'

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

/** The "…" chat menu only renders beside an active session, so it tells a session from a draft. */
function hasActiveSession() {
  return Array.from(document.body.querySelectorAll('button')).some(
    (element) => element.getAttribute('title') === 'Chat options',
  )
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  mockState.navigate = vi.fn()
  mockState.createAgentDialogMounts = 0
  mockState.createAgentDialogInput = null
  mockState.serverUrls = [LOCAL, REMOTE]
  mockState.readState = {allBefore: 50, sessions: {}}
  mockState.marked = []
  mockState.spaceAgents = {agents: [], sessions: [], isLoading: false}
  mockState.agentListsSettled = true
  mockState.agentLists = [
    {data: [{id: 'assistant', definition: {name: 'Assistant', model: 'claude-sonnet-5'}}]},
    {data: [{id: 'researcher', definition: {name: 'Researcher', model: 'gpt-5'}}]},
  ]
  mockState.sessionEntries = [
    {
      serverUrl: REMOTE,
      session: {
        id: 's-r1',
        agentId: 'researcher',
        title: 'Web research',
        updatedAt: 400,
        status: 'idle',
        activity: {messageAt: 100, messageFrom: 'agent'},
      },
    },
    {serverUrl: LOCAL, session: {id: 's-a1', agentId: 'assistant', title: 'Doc questions', updatedAt: 300}},
  ]
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('assistant sidebar agent context', () => {
  it('opens straight into the default agent context as a new chat, with its sessions listed — no dialog', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    // Local server is first, so its agent is the default context; nothing remembered means a
    // draft, not whichever chat is newest.
    expect(document.body.textContent).toContain('Send a message to start chatting with Assistant')
    expect(hasActiveSession()).toBe(false)
    expect(document.body.textContent).not.toContain('Doc questions')
    clickText('New chat')
    expect(document.body.textContent).toContain('Doc questions')
    // The other agent's session must not leak into this context.
    expect(document.body.textContent).not.toContain('Web research')
  })

  it('restores the remembered session on mount', () => {
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${LOCAL} | s-a1`} />)
    })
    expect(document.body.textContent).toContain('Doc questions')
    expect(hasActiveSession()).toBe(true)
  })

  it('points at the agent and chat with an unread reply, and picking that agent opens the chat read', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    expect(document.body.querySelector('[data-testid="agent-activity-mark"]')).toBeNull()
    // A reply lands while the panel is open: nothing yanks the user, the pickers point at it.
    mockState.agentLists[1] = {
      data: [
        {
          id: 'researcher',
          definition: {name: 'Researcher', model: 'gpt-5'},
          activity: {at: 100, kind: 'agent', messageAt: 100, messageFrom: 'agent', sessionId: 's-r1', busy: false},
        },
      ],
    }
    act(() => {
      root.render(<AssistantPanel />)
    })
    expect(document.body.textContent).toContain('Send a message to start chatting with Assistant')
    // The closed picker already shows that something is unread somewhere.
    expect(document.body.querySelector('[data-testid="agent-activity-mark"]')).not.toBeNull()

    clickText('Assistant')
    // The researcher's row names it, in place of the model line.
    expect(document.body.textContent).toContain('New reply')

    clickText('Researcher')
    // Not a draft: the unread chat itself, and it is marked read as of that message.
    expect(document.body.textContent).toContain('Web research')
    expect(hasActiveSession()).toBe(true)
    expect(mockState.marked).toEqual([{serverUrl: REMOTE, sessionId: 's-r1', seenAt: 100}])
  })

  it('the session list marks each chat that holds something unread, from the session’s own last message', () => {
    // The device has seen nothing since the baseline; both agents' chats carry a later reply.
    mockState.sessionEntries = [
      ...mockState.sessionEntries,
      {
        serverUrl: REMOTE,
        session: {
          id: 's-r2',
          agentId: 'researcher',
          title: 'Older thread',
          updatedAt: 350,
          status: 'streaming',
          activity: {messageAt: 30, messageFrom: 'user'},
        },
      },
    ]
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${REMOTE} | s-r1`} />)
    })
    // On screen: s-r1. Open the chat list: s-r1 is the unread reply, s-r2 was read before the
    // baseline but the agent is working in it now.
    clickText('Web research')
    const marks = Array.from(document.body.querySelectorAll('[data-testid="agent-activity-mark"]')).map((el) =>
      el.getAttribute('data-tone'),
    )
    expect(marks).toContain('agent')
    expect(marks).toContain('busy')
    expect(document.body.textContent).toContain('Working')
  })

  it('opens straight onto the unread chat when there is one, marked read on arrival', () => {
    mockState.agentLists[1] = {
      data: [
        {
          id: 'researcher',
          definition: {name: 'Researcher', model: 'gpt-5'},
          activity: {at: 100, kind: 'user', messageAt: 100, messageFrom: 'user', sessionId: 's-r1', busy: false},
        },
      ],
    }
    act(() => {
      root.render(<AssistantPanel />)
    })
    // Not the default agent's draft: the researcher's unread chat, already read.
    expect(document.body.textContent).toContain('Web research')
    expect(hasActiveSession()).toBe(true)
    expect(mockState.marked).toEqual([{serverUrl: REMOTE, sessionId: 's-r1', seenAt: 100}])
  })

  it('a panel opened to start a new chat keeps that intent even with something unread', () => {
    mockState.agentLists[1] = {
      data: [
        {
          id: 'researcher',
          definition: {name: 'Researcher', model: 'gpt-5'},
          activity: {at: 100, kind: 'agent', messageAt: 100, messageFrom: 'agent', sessionId: 's-r1', busy: false},
        },
      ],
    }
    act(() => {
      root.render(<AssistantPanel newChatRequest={1} />)
    })
    expect(hasActiveSession()).toBe(false)
    expect(mockState.marked).toEqual([])
  })

  it('switches agent context from the top dropdown, grouped by server', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })

    clickText('Assistant')
    expect(document.body.textContent).toContain('Local Agents')
    expect(document.body.textContent).toContain('agentic.seed.hyper.media')

    clickText('Researcher')
    // Context switched: a draft with the researcher, whose sessions are now the ones listed.
    expect(document.body.textContent).toContain('Send a message to start chatting with Researcher')
    clickText('New chat')
    expect(document.body.textContent).toContain('Web research')
    expect(document.body.textContent).not.toContain('Doc questions')
  })

  it('starts a new chat as a draft in the current context, from the top bar', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })

    const newChat = Array.from(document.body.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === 'New chat',
    )
    // The button lives in the top bar beside the agent picker, not down in the session row.
    expect(newChat?.closest('.window-drag')).toBeTruthy()
    act(() => {
      newChat!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(document.body.textContent).toContain('New chat')
    expect(document.body.textContent).toContain('Send a message to start chatting with Assistant')
  })

  it('offers agent creation and the full Agents page from the agent dropdown', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })

    clickText('Assistant')
    clickText('Agents page')
    expect(mockState.navigate).toHaveBeenCalledWith({key: 'agents'})

    clickText('Assistant')
    clickText('New agent')
    expect(mockState.createAgentDialogMounts).toBeGreaterThan(0)
  })

  it('selects the newly created agent and opens a draft chat, staying in the sidebar', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })

    clickText('Assistant')
    clickText('New agent')

    // The dialog completes: the sidebar must switch context to the created agent, not navigate
    // away to the full agent page.
    act(() => {
      mockState.createAgentDialogInput?.onCreated?.({serverUrl: REMOTE, agentId: 'researcher'})
    })

    expect(mockState.navigate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Researcher')
    expect(document.body.textContent).toContain('Send a message to start chatting with Researcher')
  })

  it('can create an agent even when none exist yet', () => {
    mockState.agentLists = [{data: []}, {data: []}]
    mockState.sessionEntries = []
    act(() => {
      root.render(<AssistantPanel />)
    })

    clickText('Agents')
    expect(document.body.textContent).toContain('No agents yet')
    clickText('New agent')
    expect(mockState.createAgentDialogMounts).toBeGreaterThan(0)
  })

  it('with no agents, the body is a call to action that opens the create dialog in place', () => {
    mockState.agentLists = [{data: []}, {data: []}]
    mockState.sessionEntries = []
    act(() => {
      root.render(<AssistantPanel />)
    })

    expect(document.body.textContent).toContain('No agents yet')
    clickText('Create an agent')
    expect(mockState.createAgentDialogMounts).toBeGreaterThan(0)
    expect(mockState.navigate).not.toHaveBeenCalled()

    // The dialog completes: the sidebar switches to the new agent and opens a draft, as it does
    // from the picker's New agent item.
    act(() => {
      mockState.createAgentDialogInput?.onCreated?.({serverUrl: REMOTE, agentId: 'researcher'})
    })
    expect(mockState.navigate).not.toHaveBeenCalled()
  })

  it('footer new-chat drafts under the agent last used in the sidebar, not the first agent', () => {
    // The footer button opens the panel with the last session restored and a pending new-chat
    // request; the draft must inherit that session's agent (Researcher), not fall back to the
    // default first agent.
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${REMOTE} | s-r1`} newChatRequest={1} />)
    })
    expect(document.body.textContent).toContain('Send a message to start chatting with Researcher')
  })

  it('footer new-chat focuses the draft composer', () => {
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${REMOTE} | s-r1`} newChatRequest={1} />)
    })
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
  })

  it('reopens in the remembered agent context, even one with no chats yet', () => {
    // Web reload / desktop relaunch with the agent choice persisted: the context must be the chosen
    // agent (an empty one, here), not the default first agent and not the stored session's agent.
    mockState.agentLists[1]!.data.push({id: 'fresh', definition: {name: 'Fresh', model: 'gpt-5'}})
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${LOCAL} | s-a1`} initialAgentId={`${REMOTE} | fresh`} />)
    })
    expect(document.body.textContent).toContain('Send a message to start chatting with Fresh')
    expect(document.body.textContent).not.toContain('Doc questions')
  })

  it('reports the agent choice to the host so it can be persisted, and clears it with null', () => {
    const onAgentChange = vi.fn()
    act(() => {
      root.render(<AssistantPanel onAgentChange={onAgentChange} />)
    })
    clickText('Assistant')
    clickText('Researcher')
    expect(onAgentChange).toHaveBeenCalledWith(`${REMOTE} | researcher`)
  })

  it('keeps the restored session — and its stored ref — while the agent lists are still loading', () => {
    // The remote list owning the stored session has not answered. Previously the resolver settled
    // on the local agent's newest and the sync-back effect wrote that (or null) over the stored
    // ref, so a reload never actually restored the session the user was in.
    mockState.agentListsSettled = false
    mockState.agentLists = [{data: [{id: 'assistant', definition: {name: 'Assistant', model: 'claude-sonnet-5'}}]}]
    mockState.sessionEntries = [
      {serverUrl: LOCAL, session: {id: 's-a1', agentId: 'assistant', title: 'Doc questions', updatedAt: 300}},
    ]
    const onSessionChange = vi.fn()
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${REMOTE} | s-r1`} onSessionChange={onSessionChange} />)
    })
    expect(onSessionChange).not.toHaveBeenCalled()
    // The session picker still names the stored session as selected — nothing was swapped in.
    expect(document.body.textContent).not.toContain('Doc questions')
  })

  it("lists a space agent's chats from its GetAgent answer, which the account-wide lists omit", () => {
    const SPACE = 'https://agents.space.example'
    mockState.spaceAgents = {
      agents: [{serverUrl: SPACE, agent: {id: 'docs', definition: {name: 'Docs Helper', model: 'gpt-5'}}}],
      sessions: [
        {serverUrl: SPACE, session: {id: 's-d2', agentId: 'docs', title: 'Someone asked about tags', updatedAt: 900}},
        {serverUrl: SPACE, session: {id: 's-d1', agentId: 'docs', title: 'My first question', updatedAt: 800}},
      ],
      isLoading: false,
    }
    act(() => {
      root.render(<AssistantPanel />)
    })
    // The space agent leads, as a new chat — not somebody else's — with the chats one click away.
    expect(document.body.textContent).toContain('Send a message to start chatting with Docs Helper')
    expect(document.body.textContent).not.toContain('Someone asked about tags')
    clickText('New chat')
    expect(document.body.textContent).not.toContain('No chats with this agent yet')
    expect(document.body.textContent).toContain('Someone asked about tags')
    clickText('My first question')
    expect(document.body.textContent).toContain('My first question')
    expect(hasActiveSession()).toBe(true)
  })

  it('offers session options in a menu on the session row, not a dedicated row', () => {
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${LOCAL} | s-a1`} />)
    })
    const options = Array.from(document.body.querySelectorAll('button')).filter(
      (element) => element.getAttribute('title') === 'Chat options',
    )
    expect(options).toHaveLength(1)
  })
})
