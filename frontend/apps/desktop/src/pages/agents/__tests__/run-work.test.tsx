import type {RunInfo} from '@/agents-client'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
// vi.mock calls below are hoisted above these imports, so components get the mocked hooks.
import {journalToolParts, RunWorkHierarchy} from '../run-work'
import {ChatMessageBubble, ToolCallLine} from '@/components/assistant-message-rendering'

/**
 * The elegant work view: journal calls rendered as chat tool rows labeled by the script's own
 * descriptions, and the checklist integrated with the children working it — the step IS the way
 * into the sub-session.
 */

const mockState = vi.hoisted(() => ({
  runs: [] as RunInfo[],
  tree: [] as RunInfo[],
  run: null as RunInfo | null,
  journal: [] as {runId: string; seq: number; entry: Record<string, unknown>; createdAt: number}[],
  navigate: vi.fn(),
  pushNavigate: vi.fn(),
}))

vi.mock('@/models/agents', () => ({
  useSessionRuns: () => ({data: mockState.runs}),
  // Honours its rootRunId argument the way the real query's `enabled` does: a caller that passed
  // undefined asked for nothing, and handing it the tree anyway would hide gating bugs.
  useRunTree: (_serverUrl: unknown, _accountUid: unknown, rootRunId: string | undefined) => ({
    data: rootRunId ? mockState.tree : [],
  }),
  useRun: () => ({data: mockState.run, isLoading: false}),
  useAgentRunTreeSubscription: () => ({runs: {}, progress: {}, activity: {}, journal: mockState.journal}),
  useCancelRun: () => ({mutate: vi.fn(), isPending: false}),
  useSignalRun: () => ({mutate: vi.fn(), isPending: false}),
  useSessionAttachmentDataUrls: () => ({}),
}))

vi.mock('@/utils/useNavigate', () => ({
  useClickNavigate: () => mockState.navigate,
  useNavigate: () => mockState.pushNavigate,
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccountId: () => 'account-1',
}))

vi.mock('@/open-url', () => ({
  useOpenUrl: () => vi.fn(),
}))

// Avoid vi.importActual here: navigation → routing → utils barrel → url-to-route → navigation
// forms a circular dependency that deadlocks vitest's module loader.
vi.mock('@shm/shared/utils/navigation', () => {
  const React = require('react')
  const NavContext = React.createContext(null)
  return {
    useNavRoute: () => ({key: 'library'}),
    useNavigation: () => ({state: {}, dispatch: vi.fn()}),
    NavContextProvider: NavContext.Provider,
    navStateReducer: (state: unknown) => state,
    getRouteKey: () => 'library',
    appRouteOfId: () => undefined,
    isHttpUrl: () => false,
    useNavigate: () => vi.fn(),
    useNavigationState: () => ({}),
    useNavigationDispatch: () => vi.fn(),
    useRouteDocId: () => null,
  }
})

vi.mock('@shm/shared/utils/entity-id-url', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/utils/entity-id-url')>(
    '@shm/shared/utils/entity-id-url',
  )
  return {...actual, packHmId: vi.fn()}
})

vi.mock('@/components/markdown', () => ({
  Markdown: ({children}: {children: React.ReactNode}) => React.createElement('div', null, children),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: null}),
  useAccount: () => ({data: null}),
}))

function makeRun(overrides: Partial<RunInfo> & Pick<RunInfo, 'id' | 'status'>): RunInfo {
  return {
    account: 'account-1',
    rootRunId: overrides.rootRunId ?? overrides.id,
    depth: 0,
    kind: 'agent',
    origin: 'user',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  } as RunInfo
}

let container: HTMLDivElement
let root: Root

function render(element: React.ReactElement) {
  act(() => {
    root.render(element)
  })
}

function click(element: Element | undefined | null) {
  act(() => element?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
}

beforeEach(() => {
  mockState.runs = []
  mockState.tree = []
  mockState.run = null
  mockState.journal = []
  mockState.navigate = vi.fn()
  mockState.pushNavigate = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('journalToolParts', () => {
  it('maps described calls to chat tool parts, pairing results by callSeq', () => {
    const parts = journalToolParts([
      {
        runId: 'wf-1',
        seq: 1,
        createdAt: 1,
        entry: {
          kind: 'call',
          op: 'tool',
          callSeq: 1,
          tool: 'web_search',
          input: {query: 'bun release'},
          description: 'Checking the latest Bun release',
        },
      },
      {runId: 'wf-1', seq: 2, createdAt: 2, entry: {kind: 'result', callSeq: 1, status: 'succeeded', output: {ok: 1}}},
      {
        runId: 'wf-1',
        seq: 3,
        createdAt: 3,
        entry: {kind: 'call', op: 'tool', callSeq: 2, tool: 'write', input: {address: '~/memory/x'}},
      },
      {
        runId: 'wf-1',
        seq: 4,
        createdAt: 4,
        entry: {kind: 'result', callSeq: 2, status: 'failed', error: {code: 'x', message: 'disk full'}},
      },
      // Agent spawns and bookkeeping are not tool rows.
      {runId: 'wf-1', seq: 5, createdAt: 5, entry: {kind: 'call', op: 'agent', callSeq: 3, input: {}}},
      {runId: 'wf-1', seq: 6, createdAt: 6, entry: {kind: 'log', level: 'info', message: 'hi'}},
    ])
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({
      name: 'web_search',
      summaryOverride: 'Checking the latest Bun release',
      rawOutput: {ok: 1},
    })
    expect(parts[1]).toMatchObject({name: 'write', isError: true, result: 'disk full'})
  })
})

describe('journaled tool rows', () => {
  it("keeps the script's narration but still shows the source and links to it", () => {
    const parent = makeRun({id: 'root-1', status: 'running', kind: 'workflow', agentId: 'agent-1'} as never)
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[]}
        journal={[
          {
            runId: 'root-1',
            seq: 1,
            createdAt: 1,
            entry: {
              kind: 'call',
              op: 'tool',
              callSeq: 1,
              tool: 'read',
              input: {address: '~/memory/notes/competitors.md'},
              description: 'Checking what we know about Acme',
            },
          },
          {
            runId: 'root-1',
            seq: 2,
            createdAt: 2,
            entry: {kind: 'result', callSeq: 1, status: 'succeeded', output: {path: 'notes/competitors.md'}},
          },
        ]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        renderToolPart={(part) => (
          <ToolCallLine item={part} serverUrl="http://localhost:3050" accountUid="account-1" agentId="agent-1" />
        )}
      />,
    )

    // The workflow's own words lead, the source chip says where the work happened…
    expect(container.textContent).toContain('Checking what we know about Acme')
    expect(container.textContent).toContain('memory')
    // …and the narration is itself the way into that memory file.
    const narration = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Checking what we know about Acme',
    )
    click(narration)
    expect(mockState.navigate).toHaveBeenCalledWith(
      expect.objectContaining({key: 'agent', tab: 'memory', memoryPath: 'notes/competitors.md'}),
      expect.anything(),
    )
  })
})

describe('integrated step rows', () => {
  const plan = {
    title: 'Research',
    steps: [
      {id: 's1', label: 'Research Notion', status: 'running' as const},
      {id: 's2', label: 'Write comparison', status: 'pending' as const},
    ],
  }
  const parent = makeRun({id: 'root-1', status: 'running', kind: 'workflow'})
  const child = makeRun({
    id: 'child-1',
    status: 'running',
    rootRunId: 'root-1',
    parentRunId: 'root-1',
    sessionId: 'child-session-1',
    stepLabel: 'Research Notion',
    title: 'Notion researcher',
  } as never)

  it('the step with an attached child IS the link into its sub-session — no duplicate row below', () => {
    const onOpenSession = vi.fn()
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[child]}
        plan={plan}
        journal={[]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        onOpenSession={onOpenSession}
        onCancelRun={vi.fn()}
      />,
    )
    // One interactive row for the step+child, labeled by the STEP.
    const stepRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Research Notion'),
    )
    expect(stepRow).toBeTruthy()
    click(stepRow)
    expect(onOpenSession).toHaveBeenCalledWith('child-session-1', undefined)
    // The child does not ALSO render as a separate loose row beneath the list.
    expect(container.textContent?.match(/Notion researcher/g) ?? []).toHaveLength(0)
    // The pending step renders as a plain, non-interactive row.
    expect(container.textContent).toContain('Write comparison')
  })

  it('a child attaches through a step rename, because the join is the step id', () => {
    // Agents rephrase their plans between turns. A child stamped with the label it was spawned
    // under would come loose the moment that happens; the stamped id still names the same step.
    const renamedPlan = {
      title: 'Research',
      steps: [
        {id: 's1', label: 'Research Notion and Coda in parallel', status: 'running' as const},
        {id: 's2', label: 'Write comparison', status: 'pending' as const},
      ],
    }
    const stamped = makeRun({
      id: 'child-1',
      status: 'running',
      rootRunId: 'root-1',
      parentRunId: 'root-1',
      sessionId: 'child-session-1',
      stepLabel: 'Research Notion',
      planStepId: 's1',
      title: 'Notion researcher',
    } as never)
    const onOpenSession = vi.fn()
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[stamped]}
        plan={renamedPlan}
        journal={[]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        onOpenSession={onOpenSession}
        onCancelRun={vi.fn()}
      />,
    )
    // The child rides the renamed step, not a loose row.
    const stepRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Research Notion and Coda in parallel'),
    )
    expect(stepRow).toBeTruthy()
    click(stepRow)
    expect(onOpenSession).toHaveBeenCalledWith('child-session-1', undefined)
    expect(container.textContent?.match(/Notion researcher/g) ?? []).toHaveLength(0)
  })

  it('a legacy child with no step id still attaches by its stamped label', () => {
    const onOpenSession = vi.fn()
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[child]}
        plan={plan}
        journal={[]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        onOpenSession={onOpenSession}
        onCancelRun={vi.fn()}
      />,
    )
    const stepRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Research Notion'),
    )
    click(stepRow)
    expect(onOpenSession).toHaveBeenCalledWith('child-session-1', undefined)
  })

  it('a batch step becomes a plain header and its children render as uniform peers', () => {
    // Two children on one step: promoting one of them into the step row would dress a single
    // sibling as the work itself and leave the rest hanging off it. Peers look like peers.
    const batchPlan = {
      title: 'Research',
      steps: [{id: 's1', label: 'Research both tools', status: 'running' as const}],
    }
    const notion = makeRun({
      id: 'child-notion',
      status: 'running',
      rootRunId: 'root-1',
      parentRunId: 'root-1',
      sessionId: 'session-notion',
      planStepId: 's1',
      title: 'Notion researcher',
    } as never)
    const coda = makeRun({
      id: 'child-coda',
      status: 'running',
      rootRunId: 'root-1',
      parentRunId: 'root-1',
      sessionId: 'session-coda',
      planStepId: 's1',
      title: 'Coda researcher',
    } as never)
    const onOpenSession = vi.fn()
    const onCancelRun = vi.fn()
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[notion, coda]}
        plan={batchPlan}
        journal={[]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        onOpenSession={onOpenSession}
        onCancelRun={onCancelRun}
      />,
    )

    // The step is still on screen with its label…
    expect(container.textContent).toContain('Research both tools')
    // …but it is no longer a way into anybody's session.
    const stepButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Research both tools'),
    )
    expect(stepButton).toBeUndefined()

    // Both children are there, each its own click target into its own session.
    const notionRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Notion researcher',
    )
    const codaRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Coda researcher',
    )
    expect(notionRow).toBeTruthy()
    expect(codaRow).toBeTruthy()
    // Peers are peers: the same row treatment, so nothing distinguishes one from the other.
    expect(notionRow!.className).toBe(codaRow!.className)
    expect(notionRow!.parentElement!.className).toBe(codaRow!.parentElement!.className)

    click(notionRow)
    expect(onOpenSession).toHaveBeenCalledWith('session-notion', undefined)
    click(codaRow)
    expect(onOpenSession).toHaveBeenCalledWith('session-coda', undefined)

    // And each carries its own cancel.
    click(container.querySelector('button[aria-label="Cancel Notion researcher"]'))
    expect(onCancelRun).toHaveBeenCalledWith('child-notion')
    click(container.querySelector('button[aria-label="Cancel Coda researcher"]'))
    expect(onCancelRun).toHaveBeenCalledWith('child-coda')
  })

  it('marks a step the runtime settled, and leaves the ones the agent closed unmarked', () => {
    // A step closed from finished sub-agents is still done — but the agent never said so, and a
    // checklist that reads identically either way credits its own bookkeeping to the agent.
    const mixedPlan = {
      title: 'Research',
      steps: [
        {id: 's1', label: 'Research both tools', status: 'done' as const, resolvedBy: 'runtime' as const},
        {id: 's2', label: 'Write the comparison', status: 'done' as const},
      ],
    }
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[]}
        plan={mixedPlan}
        journal={[]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        onOpenSession={vi.fn()}
        onCancelRun={vi.fn()}
      />,
    )
    const markers = Array.from(container.querySelectorAll('[data-testid="step-resolved-by-runtime"]'))
    expect(markers).toHaveLength(1)
    expect(markers[0]!.textContent).toBe('auto')
    expect(markers[0]!.getAttribute('title')).toBe('Settled by the runtime from completed sub-agent results')
    // It rides the step it belongs to, not the one the agent closed itself.
    expect(markers[0]!.parentElement!.textContent).toContain('Research both tools')
    expect(markers[0]!.parentElement!.textContent).not.toContain('Write the comparison')
  })

  it('a step with exactly one attached child stays the integrated row', () => {
    // The batch treatment must not leak down to the ordinary case: one child still rides the step.
    const onOpenSession = vi.fn()
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[child]}
        plan={plan}
        journal={[]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        onOpenSession={onOpenSession}
        onCancelRun={vi.fn()}
      />,
    )
    const stepRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Research Notion'),
    )
    expect(stepRow).toBeTruthy()
    click(stepRow)
    expect(onOpenSession).toHaveBeenCalledWith('child-session-1', undefined)
    // No peer row below it — the step is the only place the child appears.
    expect(container.textContent?.match(/Notion researcher/g) ?? []).toHaveLength(0)
  })

  it('a live attached child exposes its cancel on the step row', () => {
    const onCancelRun = vi.fn()
    render(
      <RunWorkHierarchy
        run={parent}
        childRuns={[child]}
        plan={plan}
        journal={[]}
        liveState={{runs: {}, progress: {}, activity: {}, journal: []}}
        onOpenSession={vi.fn()}
        onCancelRun={onCancelRun}
      />,
    )
    const cancel = container.querySelector('button[aria-label="Cancel Notion researcher"]')
    expect(cancel).toBeTruthy()
    click(cancel)
    expect(onCancelRun).toHaveBeenCalledWith('child-1')
  })
})

describe('delegate expanded view', () => {
  it('presents a timer script as elapsed time, not as delegation', () => {
    mockState.run = makeRun({
      id: 'timer-run',
      status: 'succeeded',
      kind: 'workflow',
      title: 'Five-minute timer',
    } as never)
    render(
      <ToolCallLine
        item={{
          type: 'tool',
          id: 'timer-call',
          name: 'delegate',
          args: {
            title: 'Wait five minutes and recheck Madrid',
            script: 'export default async function (input, ctx) { await ctx.sleep(300000) }',
          },
          rawOutput: {status: 'succeeded', runId: 'timer-run'},
        }}
        serverUrl="https://agents.test"
        accountUid="account-1"
      />,
    )

    expect(container.textContent).toContain('Waited')
    expect(container.textContent).toContain('Wait five minutes and recheck Madrid')
    expect(container.textContent).not.toContain('Delegate')
  })

  it('leads with the hierarchy, not the script source', () => {
    mockState.run = makeRun({
      id: 'wf-run-1',
      status: 'running',
      kind: 'workflow',
      plan: {steps: [{id: 's1', label: 'Summarize reports', status: 'running'}]},
    } as never)
    mockState.journal = [
      {
        runId: 'wf-run-1',
        seq: 1,
        createdAt: 1,
        entry: {
          kind: 'call',
          op: 'tool',
          callSeq: 1,
          tool: 'read',
          input: {address: '~/memory/reports/'},
          description: 'Listing the reports directory',
        },
      },
    ]
    const item = {
      type: 'tool' as const,
      id: 'tc-1',
      name: 'delegate',
      args: {title: 'Summarizer', script: 'export default async function SECRET_SOURCE() {}'},
      rawOutput: {status: 'spawned', runId: 'wf-run-1'},
    }
    render(<ToolCallLine item={item} serverUrl="http://localhost:3050" accountUid="account-1" />)
    // Expand the row.
    const toggle = container.querySelector('button[title="Show tool details"]')
    click(toggle)
    // The work leads: plan step and the described call, in the chat's own tool-row UI.
    expect(container.textContent).toContain('Summarize reports')
    expect(container.textContent).toContain('Listing the reports directory')
    // The script source stays behind the info dialog, not in the expanded body.
    expect(container.textContent).not.toContain('SECRET_SOURCE')
  })

  it('shows the briefing the child was given, and its result when it lands', () => {
    mockState.run = makeRun({id: 'child-run-1', status: 'succeeded'} as never)
    render(
      <ToolCallLine
        item={{
          type: 'tool',
          id: 'tc-2',
          name: 'delegate',
          args: {title: 'Researcher', brief: 'Find every competitor and their pricing.'},
          rawOutput: {status: 'succeeded', runId: 'child-run-1', sessionId: 'child-session-9', output: {count: 3}},
        }}
        serverUrl="http://localhost:3050"
        accountUid="account-1"
      />,
    )
    click(container.querySelector('button[title="Show tool details"]'))

    // The brief is what the user reviews the delegation by — it must be visible somewhere.
    expect(container.textContent).toContain('Find every competitor and their pricing.')
    expect(container.textContent).toContain('"count": 3')
    // The child's transcript is one click away.
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Open transcript')))
    expect(mockState.navigate).toHaveBeenCalledWith(
      {key: 'agent-session', sessionId: 'child-session-9', serverUrl: 'http://localhost:3050'},
      expect.anything(),
    )
  })

  it('opens a step’s sub-session by navigating, with no synthetic event to preventDefault', () => {
    mockState.run = makeRun({
      id: 'wf-run-2',
      status: 'running',
      kind: 'workflow',
      plan: {steps: [{id: 's1', label: 'Research Notion', status: 'running'}]},
    } as never)
    mockState.tree = [
      mockState.run!,
      makeRun({
        id: 'child-2',
        status: 'running',
        rootRunId: 'wf-run-2',
        parentRunId: 'wf-run-2',
        sessionId: 'child-session-2',
        stepLabel: 'Research Notion',
        title: 'Notion researcher',
      } as never),
    ]
    render(
      <ToolCallLine
        item={{type: 'tool', id: 'tc-3', name: 'delegate', args: {title: 'Notion'}, rawOutput: {runId: 'wf-run-2'}}}
        serverUrl="http://localhost:3050"
        accountUid="account-1"
      />,
    )
    click(container.querySelector('button[title="Show tool details"]'))
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Research Notion')))
    expect(mockState.pushNavigate).toHaveBeenCalledWith({
      key: 'agent-session',
      sessionId: 'child-session-2',
      serverUrl: 'http://localhost:3050',
    })
  })

  it('shows a live child’s work before it reports back, found by the call that spawned it', () => {
    // The parked delegate has no result yet — no runId, no sessionId, nothing in the transcript
    // names the child. The link lives on the run: parentToolCallId.
    mockState.runs = [makeRun({id: 'turn-1', status: 'waiting', sessionId: 'session-1'} as never)]
    mockState.tree = [
      mockState.runs[0]!,
      makeRun({
        id: 'child-live',
        status: 'running',
        rootRunId: 'turn-1',
        parentRunId: 'turn-1',
        sessionId: 'child-session-live',
        parentToolCallId: 'call-live',
        title: 'Researcher',
        plan: {steps: [{id: 's1', label: 'Read the pricing page', status: 'running'}]},
      } as never),
    ]
    render(
      <ChatMessageBubble
        message={{
          role: 'assistant',
          sessionId: 'session-1',
          parts: [{type: 'tool', id: 'call-live', name: 'delegate', args: {title: 'Researcher', brief: 'Go look.'}}],
        }}
        serverUrl="http://localhost:3050"
        accountUid="account-1"
      />,
    )
    click(container.querySelector('button[title="Show tool details"]'))

    // The child's own plan is on screen instead of "starting the child…".
    expect(container.textContent).toContain('Read the pricing page')
    expect(container.textContent).not.toContain('Starting the child')
  })

  it('links the delegation text into the child session while it is still working', () => {
    // Before the child reports back there is no sessionId in the transcript — the collapsed row
    // used to be inert until completion. The way in is the same parentToolCallId join.
    mockState.runs = [makeRun({id: 'turn-2', status: 'waiting', sessionId: 'session-1'} as never)]
    mockState.tree = [
      mockState.runs[0]!,
      makeRun({
        id: 'child-live-2',
        status: 'running',
        rootRunId: 'turn-2',
        parentRunId: 'turn-2',
        sessionId: 'child-session-live-2',
        parentToolCallId: 'call-live-2',
        title: 'Researcher',
      } as never),
    ]
    render(
      <ChatMessageBubble
        message={{
          role: 'assistant',
          sessionId: 'session-1',
          parts: [{type: 'tool', id: 'call-live-2', name: 'delegate', args: {title: 'Researcher', brief: 'Go.'}}],
        }}
        serverUrl="http://localhost:3050"
        accountUid="account-1"
      />,
    )
    // The collapsed row's delegation text is a live link, not inert text.
    const link = container.querySelector('button[title="Open Researcher"]')
    expect(link).not.toBeNull()
    click(link)
    expect(mockState.navigate).toHaveBeenCalledWith(
      {key: 'agent-session', sessionId: 'child-session-live-2', serverUrl: 'http://localhost:3050'},
      expect.anything(),
    )
  })

  it('a detached child that outlives its finished turn still resolves, to the newest continueAsNew link', () => {
    // Eric's live repro: "until I tell you to stop" spawned a detached monitoring workflow, the
    // turn succeeded, and the delegate row spun on "Starting the child…" forever — the child
    // lookup was gated on the turn still being live. The loop's every link carries the same
    // spawning call; the row must find the tree after the turn ends and show the link still alive.
    mockState.runs = [makeRun({id: 'turn-3', status: 'succeeded', sessionId: 'session-1'} as never)]
    mockState.tree = [
      mockState.runs[0]!,
      makeRun({
        id: 'loop-1',
        status: 'succeeded',
        kind: 'workflow',
        rootRunId: 'turn-3',
        parentRunId: 'turn-3',
        parentToolCallId: 'call-loop',
        title: 'Madrid weather monitor',
      } as never),
      makeRun({
        id: 'loop-2',
        status: 'waiting',
        kind: 'workflow',
        rootRunId: 'turn-3',
        parentRunId: 'turn-3',
        parentToolCallId: 'call-loop',
        continuedFromRunId: 'loop-1',
        title: 'Madrid weather monitor',
        plan: {steps: [{id: 's1', label: 'Check the temperature', status: 'running'}]},
      } as never),
    ]
    render(
      <ChatMessageBubble
        message={{
          role: 'assistant',
          sessionId: 'session-1',
          parts: [{type: 'tool', id: 'call-loop', name: 'delegate', args: {title: 'Monitor', brief: 'Watch it.'}}],
        }}
        serverUrl="http://localhost:3050"
        accountUid="account-1"
      />,
    )
    click(container.querySelector('button[title="Show tool details"]'))

    // The live link's own work is on screen instead of the spinner.
    expect(container.textContent).toContain('Check the temperature')
    expect(container.textContent).not.toContain('Starting the child')
  })

  it("shows only this run's own calls, never a sibling script's", () => {
    mockState.run = makeRun({id: 'wf-run-3', status: 'running', kind: 'workflow'} as never)
    // The subscription is keyed by ROOT run, so it carries every branch of the tree.
    mockState.journal = [
      {
        runId: 'wf-run-3',
        seq: 1,
        createdAt: 1,
        entry: {kind: 'call', op: 'tool', callSeq: 1, tool: 'read', input: {}, description: 'My own call'},
      },
      {
        runId: 'sibling-run',
        seq: 2,
        createdAt: 2,
        entry: {kind: 'call', op: 'tool', callSeq: 1, tool: 'read', input: {}, description: "A sibling's call"},
      },
    ]
    render(
      <ToolCallLine
        item={{type: 'tool', id: 'tc-4', name: 'delegate', args: {title: 'Mine'}, rawOutput: {runId: 'wf-run-3'}}}
        serverUrl="http://localhost:3050"
        accountUid="account-1"
      />,
    )
    click(container.querySelector('button[title="Show tool details"]'))
    expect(container.textContent).toContain('My own call')
    expect(container.textContent).not.toContain("A sibling's call")
  })
})
