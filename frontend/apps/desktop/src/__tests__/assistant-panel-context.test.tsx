import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The sidebar mirrors the Agents page: the dropdown at the top filters the chat list to one agent
 * or to all of them, the list has a composer below it, and an open chat has a back button to the
 * list it came from. No dialog stands anywhere in that flow.
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
  useAllAgentSessionPages: () => ({
    entries: mockState.sessionEntries,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    isLoading: false,
    serverErrors: [],
  }),
  // One agent's own paged list: the account-wide entries plus a space agent's, filtered to it.
  useAgentSessions: (serverUrl: string | undefined, _account: unknown, agentId: string | undefined) => {
    const all = [...mockState.sessionEntries, ...mockState.spaceAgents.sessions]
    const sessions = all
      .filter((entry) => entry.serverUrl === serverUrl && entry.session.agentId === agentId)
      .map((entry) => entry.session)
    return {
      data: agentId ? {pages: [{sessions}]} : undefined,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
  },
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
  AddModelProviderDialog: () => null,
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

/** The "…" chat menu only renders in an open chat's header, so it tells a chat from the list. */
function hasActiveSession() {
  return Array.from(document.body.querySelectorAll('button')).some(
    (element) => element.getAttribute('title') === 'Chat options',
  )
}

function buttonByTitle(title: string) {
  return Array.from(document.body.querySelectorAll('button')).find(
    (element) => element.getAttribute('title') === title,
  ) as HTMLButtonElement | undefined
}

function click(element: Element | null | undefined) {
  expect(element).toBeTruthy()
  act(() => {
    element!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
}

/** The agent dropdown's trigger, whose label is the current filter. */
function pickerTrigger() {
  return document.body.querySelector('.group\\/agentpicker button') as HTMLButtonElement | null
}

/** Clicks an entry inside the open agent dropdown (list rows can carry the same agent names). */
function clickInPicker(text: string) {
  const button = Array.from(document.body.querySelectorAll('[role="dialog"] button')).find((element) =>
    element.textContent?.includes(text),
  )
  click(button)
}

function composer() {
  return document.body.querySelector('[data-testid="rich-composer"]')
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

describe('assistant sidebar', () => {
  it("opens on every agent's chats, with a composer below — no dialog", () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    expect(hasActiveSession()).toBe(false)
    expect(pickerTrigger()?.textContent).toContain('All agents')
    expect(document.body.textContent).toContain('Web research')
    expect(document.body.textContent).toContain('Doc questions')
    expect(composer()).not.toBeNull()
  })

  it('restores the remembered chat on mount, with a way back to the list', () => {
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${LOCAL} | s-a1`} />)
    })
    expect(document.body.textContent).toContain('Doc questions')
    expect(hasActiveSession()).toBe(true)
    expect(buttonByTitle('Back to chats')).toBeTruthy()
  })

  it('picking an agent filters the list to its chats, and All agents lists everyone again', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    click(pickerTrigger())
    // Grouped by server.
    expect(document.body.textContent).toContain('Local Agents')
    expect(document.body.textContent).toContain('agentic.seed.hyper.media')
    clickInPicker('Researcher')
    expect(pickerTrigger()?.textContent).toContain('Researcher')
    expect(document.body.textContent).toContain('Web research')
    expect(document.body.textContent).not.toContain('Doc questions')

    click(pickerTrigger())
    clickInPicker('All agents')
    expect(document.body.textContent).toContain('Web research')
    expect(document.body.textContent).toContain('Doc questions')
  })

  it('opening a chat from the list shows it, and back returns to the same filtered list', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    click(pickerTrigger())
    clickInPicker('Researcher')
    clickText('Web research')
    expect(hasActiveSession()).toBe(true)

    click(buttonByTitle('Back to chats'))
    expect(hasActiveSession()).toBe(false)
    expect(pickerTrigger()?.textContent).toContain('Researcher')
    expect(document.body.textContent).toContain('Web research')
    expect(document.body.textContent).not.toContain('Doc questions')
  })

  it('the list marks each chat that holds something unread, or that an agent is working in', () => {
    // The device has seen nothing since the baseline; the researcher's chat carries a later reply.
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
      root.render(<AssistantPanel />)
    })
    const marks = Array.from(document.body.querySelectorAll('[data-testid="agent-activity-mark"]')).map((el) =>
      el.getAttribute('data-tone'),
    )
    expect(marks).toContain('agent')
    expect(marks).toContain('busy')
    expect(document.body.textContent).toContain('Working')
  })

  it('points at the agent with an unread reply from the closed dropdown', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    expect(pickerTrigger()?.querySelector('[data-testid="agent-activity-mark"]')).toBeNull()
    // A reply lands while the panel is open: nothing yanks the user, the dropdown points at it.
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
    expect(hasActiveSession()).toBe(false)
    expect(pickerTrigger()?.querySelector('[data-testid="agent-activity-mark"]')).not.toBeNull()
    click(pickerTrigger())
    // The researcher's row names it, in place of the model line.
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('New reply')
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

  it('New chat in the top bar returns from a chat to the list, cursor in its composer', () => {
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${LOCAL} | s-a1`} />)
    })
    expect(hasActiveSession()).toBe(true)
    const newChat = buttonByTitle('New chat')
    // The button lives in the top bar beside the agent dropdown.
    expect(newChat?.closest('.window-drag')).toBeTruthy()
    click(newChat)
    expect(hasActiveSession()).toBe(false)
    expect(document.activeElement).toBe(composer())
  })

  it('offers agent creation and the full Agents page from the agent dropdown', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })

    click(pickerTrigger())
    clickInPicker('Agents page')
    expect(mockState.navigate).toHaveBeenCalledWith({key: 'agents'})

    click(pickerTrigger())
    clickInPicker('New agent')
    expect(mockState.createAgentDialogMounts).toBeGreaterThan(0)
  })

  it('filters to a newly created agent with the composer ready, staying in the sidebar', () => {
    act(() => {
      root.render(<AssistantPanel />)
    })
    click(pickerTrigger())
    clickInPicker('New agent')

    // The dialog completes: the sidebar switches to the created agent, not away to its full page.
    act(() => {
      mockState.createAgentDialogInput?.onCreated?.({serverUrl: REMOTE, agentId: 'researcher'})
    })

    expect(mockState.navigate).not.toHaveBeenCalled()
    expect(pickerTrigger()?.textContent).toContain('Researcher')
    expect(document.body.textContent).not.toContain('Doc questions')
    expect(composer()).not.toBeNull()
  })

  it('can create an agent even when none exist yet', () => {
    mockState.agentLists = [{data: []}, {data: []}]
    mockState.sessionEntries = []
    act(() => {
      root.render(<AssistantPanel />)
    })

    click(pickerTrigger())
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('No agents yet')
    clickInPicker('New agent')
    expect(mockState.createAgentDialogMounts).toBeGreaterThan(0)
  })

  it('with no agents, the body is a call to action that opens the create dialog in place', () => {
    mockState.agentLists = [{data: []}, {data: []}]
    mockState.sessionEntries = []
    act(() => {
      root.render(<AssistantPanel />)
    })

    expect(document.body.textContent).toContain('No agents yet')
    expect(composer()).toBeNull()
    clickText('Create an agent')
    expect(mockState.createAgentDialogMounts).toBeGreaterThan(0)
    act(() => {
      mockState.createAgentDialogInput?.onCreated?.({serverUrl: REMOTE, agentId: 'researcher'})
    })
    expect(mockState.navigate).not.toHaveBeenCalled()
  })

  it('a new chat from the footer starts with the agent of the chat that was open', () => {
    // The footer button opens the panel with the last chat restored and a pending new-chat
    // request: the composer must start with that chat's agent (Researcher), not the first agent.
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${REMOTE} | s-r1`} newChatRequest={1} />)
    })
    expect(hasActiveSession()).toBe(false)
    const agentButton = document.body.querySelector('button[aria-label="Choose the agent for the new session"]')
    expect(agentButton?.textContent).toContain('Researcher')
  })

  it('a new chat from the footer focuses the composer', () => {
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${REMOTE} | s-r1`} newChatRequest={1} />)
    })
    expect(document.activeElement).toBe(composer())
  })

  it("reopens on the remembered agent's list, even one with no chats yet", () => {
    mockState.agentLists[1]!.data.push({id: 'fresh', definition: {name: 'Fresh', model: 'gpt-5'}})
    act(() => {
      root.render(<AssistantPanel initialAgentId={`${REMOTE} | fresh`} />)
    })
    expect(pickerTrigger()?.textContent).toContain('Fresh')
    expect(document.body.textContent).toContain('No chats with this agent yet.')
    expect(document.body.textContent).not.toContain('Doc questions')
  })

  it('reports the filter to the host so it can be persisted, and All agents as null', () => {
    const onAgentChange = vi.fn()
    act(() => {
      root.render(<AssistantPanel onAgentChange={onAgentChange} />)
    })
    click(pickerTrigger())
    clickInPicker('Researcher')
    expect(onAgentChange).toHaveBeenLastCalledWith(`${REMOTE} | researcher`)
    click(pickerTrigger())
    clickInPicker('All agents')
    expect(onAgentChange).toHaveBeenLastCalledWith(null)
  })

  it('keeps the restored chat — and its stored ref — while the agent lists are still loading', () => {
    // The remote list owning the stored chat has not answered: closing the chat now would write
    // null over the remembered ref, and a reload would never restore it.
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
    expect(hasActiveSession()).toBe(true)
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
    // All agents: the space agent's chats sit beside the user's own.
    expect(document.body.textContent).toContain('Someone asked about tags')
    expect(document.body.textContent).toContain('Doc questions')
    click(pickerTrigger())
    clickInPicker('Docs Helper')
    expect(document.body.textContent).toContain('My first question')
    expect(document.body.textContent).not.toContain('Doc questions')
    clickText('My first question')
    expect(hasActiveSession()).toBe(true)
  })

  it("offers chat options in the open chat's header, beside the back button, and not on the list", () => {
    act(() => {
      root.render(<AssistantPanel initialSessionId={`${LOCAL} | s-a1`} />)
    })
    const options = () =>
      Array.from(document.body.querySelectorAll('button')).filter(
        (element) => element.getAttribute('title') === 'Chat options',
      )
    expect(options()).toHaveLength(1)
    click(buttonByTitle('Back to chats'))
    expect(options()).toHaveLength(0)
  })
})
