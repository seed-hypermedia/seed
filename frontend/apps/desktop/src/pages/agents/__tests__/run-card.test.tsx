import type {RunInfo} from '@/agents-client'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
// vi.mock calls below are hoisted above this import, so the cards get the mocked hooks.
import {RunRecordCard, SessionRunCard} from '../run-card'

/**
 * Rendering coverage for the run cards.
 *
 * Two surfaces, one body: the pinned card carries a run only while it is live, and the transcript
 * record card is where a finished run is kept. Both are driven entirely by durable run data, so
 * these mount them against fixed `RunInfo`s rather than a live server and assert what a user sees.
 */

const mockState = vi.hoisted(() => ({
  runs: [] as RunInfo[],
  tree: [] as RunInfo[],
  run: null as RunInfo | null,
  journal: [] as {runId: string; seq: number; entry: Record<string, unknown>; createdAt: number}[],
  cancel: vi.fn(),
}))

vi.mock('@/models/agents', () => ({
  useSessionRuns: () => ({data: mockState.runs}),
  useRunTree: () => ({data: mockState.tree}),
  useRun: () => ({data: mockState.run, isLoading: false}),
  useAgentRunTreeSubscription: () => ({runs: {}, progress: {}, activity: {}, journal: mockState.journal}),
  useCancelRun: () => ({mutate: mockState.cancel, isPending: false}),
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

/** A run spawned under `root-1`, which is what the card's descendant walk looks for. */
function makeChild(overrides: Partial<RunInfo> & Pick<RunInfo, 'id' | 'status'>): RunInfo {
  return makeRun({rootRunId: 'root-1', parentRunId: 'root-1', depth: 1, origin: 'agent', ...overrides})
}

let container: HTMLDivElement
let root: Root

function render(element: React.ReactElement) {
  act(() => {
    root.render(element)
  })
}

function buttonWithText(text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text)
}

function click(element: Element | undefined) {
  act(() => element?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
}

beforeEach(() => {
  mockState.runs = []
  mockState.tree = []
  mockState.run = null
  mockState.journal = []
  mockState.cancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const baseProps = {serverUrl: 'http://localhost:3050', accountUid: 'account-1', sessionId: 'session-1'}

describe('SessionRunCard (pinned)', () => {
  it('renders nothing without a run or a plan', () => {
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toBe('')
  })

  it('shows a live run with its steps, children and a cancel control', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Compare competitors'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({id: 'child-1', status: 'succeeded', title: 'Research Acme', sessionId: 'child-s1'}),
      makeChild({id: 'child-2', status: 'running', title: 'Research Globex'}),
    ]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{steps: [{id: 's1', label: 'Fan out research', status: 'running'}]}}
      />,
    )
    expect(container.textContent).toContain('Compare competitors')
    expect(container.textContent).toContain('Running')
    expect(container.textContent).toContain('Fan out research')
    expect(container.textContent).toContain('Research Acme')
    expect(container.textContent).toContain('Research Globex')
    expect(buttonWithText('Cancel')).toBeTruthy()
  })

  it('disappears once the run finishes — the transcript keeps the record', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'succeeded', title: 'All done', finishedAt: 5000})]
    mockState.tree = [mockState.runs[0]!, makeChild({id: 'child-1', status: 'succeeded', title: 'Child'})]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toBe('')
  })

  it('does not pin a summary of a plain finished chat turn', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'succeeded'})]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toBe('')
  })

  it('does not pin a panel for a plain live chat turn — tools stream in the scroll log', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running'})]
    mockState.tree = [mockState.runs[0]!]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toBe('')
  })

  it('appears the moment a live turn spawns its first child', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running'})]
    mockState.tree = [mockState.runs[0]!, makeChild({id: 'child-1', status: 'running', title: 'Worker'})]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toContain('Worker')
  })

  it('asks for confirmation before canceling the whole run', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Long job'})]
    // The pinned panel exists only for orchestrations, so the cancelable run has a child.
    mockState.tree = [mockState.runs[0]!, makeChild({id: 'child-1', status: 'running', title: 'Worker'})]
    render(<SessionRunCard {...baseProps} />)

    click(buttonWithText('Cancel'))
    expect(mockState.cancel).not.toHaveBeenCalled()

    click(buttonWithText('Cancel run'))
    expect(mockState.cancel).toHaveBeenCalledWith('root-1')
  })

  it('names the sub-sessions a parked run is waiting on', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'waiting', title: 'Parent turn'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({id: 'child-1', status: 'succeeded', title: 'One'}),
      makeChild({id: 'child-2', status: 'running', title: 'Two'}),
    ]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toContain('Waiting on 2 sub-sessions — 1 done')
  })

  it('cancels one child on the spot, without a confirmation step', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Fan out'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({id: 'child-1', status: 'running', title: 'Slow one'}),
      makeChild({id: 'child-2', status: 'succeeded', title: 'Quick one'}),
    ]
    render(<SessionRunCard {...baseProps} />)

    // Only the unfinished child offers one.
    const cancels = Array.from(container.querySelectorAll('[aria-label^="Cancel "]'))
    expect(cancels.map((node) => node.getAttribute('aria-label'))).toEqual(['Cancel Slow one'])

    click(cancels[0])
    expect(mockState.cancel).toHaveBeenCalledWith('child-1')
  })

  it('drops plan steps that only repeat a child run title', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Fan out'})]
    mockState.tree = [mockState.runs[0]!, makeChild({id: 'child-1', status: 'running', title: 'Research Acme'})]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{
          steps: [
            {id: 's1', label: 'research acme', status: 'running'},
            {id: 's2', label: 'Write the summary', status: 'pending'},
          ],
        }}
      />,
    )
    // The child row is authoritative for its own step: one mention of it, not two.
    expect(container.textContent).not.toContain('research acme')
    expect(container.textContent).toContain('Research Acme')
    expect(container.textContent).toContain('Write the summary')
  })

  it('keeps an unfinished todo list after the run ends, but stops spinning it', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'succeeded'})]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{
          steps: [
            {id: 's1', label: 'Drafted', status: 'done'},
            {id: 's2', label: 'Left hanging', status: 'running'},
          ],
        }}
      />,
    )
    expect(container.textContent).toContain('Left hanging')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('hides a todo list with nothing left to do', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'succeeded'})]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{
          steps: [
            {id: 's1', label: 'Drafted', status: 'done'},
            {id: 's2', label: 'Abandoned', status: 'skipped'},
          ],
        }}
      />,
    )
    expect(container.textContent).toBe('')
  })
})

describe('RunRecordCard (in the chat bubble)', () => {
  const recordProps = {serverUrl: 'http://localhost:3050', accountUid: 'account-1', runId: 'root-1'}

  it('renders the finished run: status, steps, children and error', () => {
    mockState.run = makeRun({
      id: 'root-1',
      status: 'failed',
      kind: 'workflow',
      title: 'Link fixer',
      error: {code: 'tool_failed', message: 'boom'},
      plan: {steps: [{id: 's1', label: 'Scan pages', status: 'done'}]},
    })
    mockState.tree = [mockState.run, makeChild({id: 'child-1', status: 'succeeded', title: 'Fix /about'})]
    render(<RunRecordCard {...recordProps} />)

    expect(container.textContent).toContain('Link fixer')
    expect(container.textContent).toContain('Failed')
    expect(container.textContent).toContain('boom')
    expect(container.textContent).toContain('Scan pages')
    expect(container.textContent).toContain('Fix /about')
  })

  it('never spins a step or pulses a child under a finished run', () => {
    mockState.run = makeRun({
      id: 'root-1',
      status: 'succeeded',
      kind: 'workflow',
      title: 'Finished workflow',
      // Rows written before the service learned to settle a terminal run's plan.
      plan: {
        steps: [
          {id: 's1', label: 'Still marked running', status: 'running'},
          {id: 's2', label: 'Never started', status: 'pending'},
        ],
      },
    })
    mockState.tree = [mockState.run, makeChild({id: 'child-1', status: 'running', title: 'Stale child'})]
    render(<RunRecordCard {...recordProps} />)

    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
    // Nothing under a finished run is cancelable either.
    expect(container.querySelector('[aria-label^="Cancel "]')).toBeNull()
    expect(buttonWithText('Cancel')).toBeUndefined()
  })

  it('offers the whole-run cancel while its run is still live', () => {
    mockState.run = makeRun({id: 'root-1', status: 'running', kind: 'workflow', title: 'Working'})
    mockState.tree = [mockState.run]
    render(<RunRecordCard {...recordProps} />)
    expect(buttonWithText('Cancel')).toBeTruthy()
  })

  it('shows only its own branch of the tree, not its siblings', () => {
    const branch = makeRun({
      id: 'branch-1',
      rootRunId: 'root-1',
      parentRunId: 'root-1',
      status: 'succeeded',
      title: 'My workflow',
    })
    mockState.run = branch
    mockState.tree = [
      makeRun({id: 'root-1', status: 'succeeded', title: 'Chat turn'}),
      branch,
      makeRun({id: 'mine-1', rootRunId: 'root-1', parentRunId: 'branch-1', status: 'succeeded', title: 'My child'}),
      makeChild({id: 'sibling-1', status: 'succeeded', title: 'Someone else'}),
    ]
    render(<RunRecordCard {...recordProps} runId="branch-1" />)

    expect(container.textContent).toContain('My workflow')
    expect(container.textContent).toContain('My child')
    expect(container.textContent).not.toContain('Someone else')
  })

  it('keeps the activity journal collapsed until asked, then shows it oldest-first', () => {
    mockState.run = makeRun({id: 'root-1', status: 'running', kind: 'workflow', title: 'Workflow'})
    mockState.tree = [mockState.run]
    mockState.journal = [
      {runId: 'root-1', seq: 2, createdAt: 200, entry: {kind: 'call', op: 'tool', tool: 'search'}},
      {runId: 'root-1', seq: 1, createdAt: 100, entry: {kind: 'step', stepId: 's1', label: 'Gather', phase: 'start'}},
      {runId: 'child-1', seq: 1, createdAt: 300, entry: {kind: 'log', level: 'warn', message: 'retrying'}},
      {runId: 'child-1', seq: 2, createdAt: 400, entry: {kind: 'result', status: 'failed', error: {message: 'nope'}}},
      // Replay bookkeeping, not activity — never rendered.
      {runId: 'root-1', seq: 3, createdAt: 500, entry: {kind: 'now', value: 12345}},
    ]
    render(<RunRecordCard {...recordProps} />)
    expect(container.textContent).toContain('Activity')
    expect(container.textContent).not.toContain('Gather')

    click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('Activity')))

    const drawer = container.querySelector('[aria-label="Run activity"]')
    const lines = Array.from(drawer?.children ?? []).map((node) => node.textContent)
    expect(lines).toEqual(['step: Gather (start)', 'tool: search', 'warn · retrying', 'failed: nope'])
  })
})
