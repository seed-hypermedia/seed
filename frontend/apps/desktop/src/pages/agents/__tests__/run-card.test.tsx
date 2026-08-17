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
  signal: vi.fn(),
}))

// The card renders the chat's own tool rows, which reach for navigation and the app context —
// neither exists in this environment, and neither is what these tests are about.
vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => vi.fn(),
  useClickNavigate: () => vi.fn(),
}))

vi.mock('@/open-url', () => ({
  useOpenUrl: () => vi.fn(),
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccountId: () => 'account-1',
}))

vi.mock('@/components/markdown', () => ({
  Markdown: ({children}: {children: React.ReactNode}) => React.createElement('div', null, children),
}))

vi.mock('@/models/agents', () => ({
  useSessionRuns: () => ({data: mockState.runs}),
  useRunTree: () => ({data: mockState.tree}),
  useRun: () => ({data: mockState.run, isLoading: false}),
  useAgentRunTreeSubscription: () => ({runs: {}, progress: {}, activity: {}, journal: mockState.journal}),
  useCancelRun: () => ({mutate: mockState.cancel, isPending: false}),
  useSignalRun: () => ({mutate: mockState.signal, isPending: false}),
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
  mockState.signal = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
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

  it('shows a parked timer inside its active plan step and visibly counts down', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    mockState.runs = [makeRun({id: 'root-1', status: 'waiting', title: 'Madrid weather check'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({
        id: 'timer-1',
        status: 'waiting',
        kind: 'workflow',
        title: 'Wait five minutes and recheck Madrid',
        planStepId: 'wait',
        updatedAt: 10_000,
        wait: {reason: 'timer', wakeAt: 310_000},
      } as never),
    ]
    mockState.journal = [
      {
        runId: 'timer-1',
        seq: 1,
        createdAt: 10_000,
        entry: {kind: 'timer', callSeq: 1, key: 'sleep|300000', wakeAt: 310_000},
      },
    ]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{steps: [{id: 'wait', label: 'Wait five minutes and recheck', status: 'running'}]}}
      />,
    )

    const timer = container.querySelector('[role="timer"]') as HTMLElement
    expect(timer).toBeTruthy()
    expect(timer.textContent).toContain('5:00 left')
    const fill = timer.querySelector('[style]') as HTMLElement
    expect(fill.style.width).toBe('0%')

    act(() => vi.advanceTimersByTime(61_000))
    expect(timer.textContent).toContain('3:59 left')
    expect(Number.parseFloat(fill.style.width)).toBeGreaterThan(20)
    // The timer is integrated into the plan row; its workflow title is not repeated below it.
    expect(container.textContent).not.toContain('Wait five minutes and recheck Madrid')
    vi.useRealTimers()
  })

  it('clears the pinned slot as soon as the transcript has frozen the run, mid-flight', () => {
    // The run is still going, but its story settled: the scroll already holds this card at the
    // moment it settled, so pinning a second copy would tell it twice.
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Compare competitors'})]
    mockState.tree = [mockState.runs[0]!, makeChild({id: 'child-1', status: 'succeeded', title: 'Research Acme'})]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{steps: [{id: 's1', label: 'Fan out research', status: 'done'}]}}
        frozenRunIds={new Set(['root-1'])}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('keeps pinning a live run the transcript has not frozen', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Compare competitors'})]
    mockState.tree = [mockState.runs[0]!, makeChild({id: 'child-1', status: 'running', title: 'Research Acme'})]
    render(<SessionRunCard {...baseProps} frozenRunIds={new Set(['some-other-run'])} />)
    expect(container.textContent).toContain('Compare competitors')
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

  it('a run parked on a question offers the answer, and sends the signal it named', () => {
    mockState.runs = [
      makeRun({
        id: 'root-1',
        status: 'waiting',
        title: 'Publish the brief',
        wait: {reason: 'event', label: 'sign-off from Eric', answerWith: 'approved'},
      } as never),
    ]
    mockState.tree = [mockState.runs[0]!]
    render(<SessionRunCard {...baseProps} />)

    // The card says what it is waiting for, and offers the one click that ends the wait.
    expect(container.textContent).toContain('sign-off from Eric')
    const answer = buttonWithText('Answer')
    expect(answer).toBeTruthy()
    click(answer)
    // The signal name comes from the run, not from the UI guessing: a wait for "approved" would
    // ignore anything else.
    expect(mockState.signal).toHaveBeenCalledWith(
      {runId: 'root-1', signal: 'approved'},
      expect.objectContaining({onSuccess: expect.any(Function)}),
    )
  })

  it('a run paused on its budget offers a resume instead', () => {
    mockState.runs = [
      makeRun({
        id: 'root-1',
        status: 'waiting',
        title: 'Long crawl',
        wait: {reason: 'budget-pause', label: 'Paused after 2 hours: its time budget was 1 hour'},
      } as never),
    ]
    mockState.tree = [mockState.runs[0]!]
    render(<SessionRunCard {...baseProps} />)

    // The pill stops saying "Waiting": this is the one wait that needs a person.
    expect(container.textContent).toContain('Paused')
    // The server's own note is what the card shows; the generic copy is only for a note-less pause.
    expect(container.textContent).toContain('Paused after 2 hours: its time budget was 1 hour')
    expect(buttonWithText('Answer')).toBeUndefined()
    click(buttonWithText('Resume'))
    expect(mockState.signal).toHaveBeenCalledWith(
      {runId: 'root-1', signal: 'resume'},
      expect.objectContaining({onSuccess: expect.any(Function)}),
    )
  })

  it('falls back to plain copy for a budget pause that came with no note', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'waiting', wait: {reason: 'budget-pause'}} as never)]
    mockState.tree = [mockState.runs[0]!]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toContain('Paused: out of time budget')
  })

  it('offers nothing to answer when the run is waiting on something other than a person', () => {
    // Children and the activity feed resolve themselves; a button there would be a lie.
    mockState.runs = [makeRun({id: 'root-1', status: 'waiting', title: 'Fan out'})]
    mockState.tree = [mockState.runs[0]!, makeChild({id: 'child-1', status: 'running', title: 'Worker'})]
    render(<SessionRunCard {...baseProps} />)
    expect(buttonWithText('Answer')).toBeUndefined()
    expect(buttonWithText('Resume')).toBeUndefined()
  })

  it('a failed child with a long error keeps its title visible, truncated error, and click target', () => {
    const longError =
      'Invalid request: Your request exceeded model token limit: 262144 (requested: 284345) and then some more detail that goes on and on'
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Analysis'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({
        id: 'child-1',
        status: 'failed',
        title: 'Analyze BIB File',
        sessionId: 'session-child-1',
        error: {code: 'provider-error', message: longError},
      }),
    ]
    const opened: string[] = []
    render(<SessionRunCard {...baseProps} onOpenSession={(sessionId) => opened.push(sessionId)} />)
    expect(container.textContent).toContain('Analyze BIB File')
    // The error is present but yields space (truncated), never flex-none — and it is its own
    // click target for interrogation, so it must not pretend to be plain text.
    const errorSpan = Array.from(container.querySelectorAll('span')).find(
      (span) => span.textContent?.startsWith('Invalid request'),
    )
    expect(errorSpan?.getAttribute('role')).toBe('button')
    expect(errorSpan?.className).toContain('truncate')
    expect(errorSpan?.className).not.toContain('flex-none')
    // Clicking the error opens the full message (code + complete text), NOT the child session:
    // the chip swallows the click so interrogating a failure never navigates away from the card.
    click(errorSpan)
    expect(opened).toEqual([])
    const popover = Array.from(document.querySelectorAll('pre')).find((pre) => pre.textContent === longError)
    expect(popover).toBeTruthy()
    expect(document.body.textContent).toContain('provider-error')
    // The row is still clickable and opens the child session.
    const row = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Analyze BIB File'),
    )
    expect(row).toBeTruthy()
    click(row)
    expect(opened).toContain('session-child-1')
  })

  it('the error inspector shows the failing tool call with its arguments', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Publish paper'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({
        id: 'child-1',
        status: 'failed',
        kind: 'workflow',
        title: 'Dry-run and publish',
        error: {code: 'quota-exceeded', message: 'Site quota exceeded', tool: 'publish', callSeq: 2},
      }),
    ]
    mockState.journal = [
      {
        runId: 'child-1',
        seq: 1,
        entry: {kind: 'call', callSeq: 2, op: 'tool', tool: 'publish', input: {path: '/paper', bytes: 12345}},
        createdAt: 1500,
      },
      {
        runId: 'child-1',
        seq: 2,
        entry: {kind: 'result', callSeq: 2, status: 'failed', error: {code: 'quota-exceeded'}},
        createdAt: 1600,
      },
    ]
    render(<SessionRunCard {...baseProps} />)
    const errorSpan = Array.from(container.querySelectorAll('span')).find(
      (span) => span.getAttribute('role') === 'button' && span.textContent === 'Site quota exceeded',
    )
    click(errorSpan)
    // The popover names the exact call the run died on — not just the message.
    expect(document.body.textContent).toContain('Failing tool call')
    expect(document.body.textContent).toContain('publish')
    expect(document.body.textContent).toContain('quota-exceeded')
  })

  it('the error inspector shows the offending source line for a script error', () => {
    const source = [
      'export default async function (input, ctx) {',
      '  const a = 1',
      '  return new MissingGlobal()',
      '}',
    ].join('\n')
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Publish paper'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({
        id: 'child-1',
        status: 'failed',
        kind: 'workflow',
        title: 'Dry-run and publish',
        sourceText: source,
        error: {
          code: 'workflow-error',
          message: "'MissingGlobal' is not defined",
          stack: '    at <anonymous> (workflow.js:3:14)\n    at <eval> (kickoff.js:5:1)',
        },
      }),
    ]
    render(<SessionRunCard {...baseProps} />)
    const errorSpan = Array.from(container.querySelectorAll('span')).find(
      (span) => span.getAttribute('role') === 'button' && span.textContent?.includes('MissingGlobal'),
    )
    click(errorSpan)
    expect(document.body.textContent).toContain('workflow source, line 3')
    expect(document.body.textContent).toContain('return new MissingGlobal()')
    expect(document.body.textContent).toContain('workflow.js:3:14')
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
    // The step and the child working it are ONE row, labeled by the step — the child rides along
    // as status and as the row's way in, never as a second row saying the same thing.
    expect(container.textContent).toContain('research acme')
    expect(container.textContent).not.toContain('Research Acme')
    expect(container.textContent).toContain('Write the summary')
  })

  it('renders a stepLabel-stamped child in place of its plan step, even when titles differ', () => {
    // The live bug: step "Research common supplements", child titled "Research common health
    // supplements" — same work shown twice. The stamp is the structural link titles can't be.
    mockState.runs = [makeRun({id: 'root-1', status: 'waiting', title: 'Build KB'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({
        id: 'child-1',
        status: 'running',
        title: 'Research common health supplements',
        stepLabel: 'Research common supplements',
      }),
    ]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{
          steps: [
            {id: 's1', label: 'Research common supplements', status: 'running'},
            {id: 's2', label: 'Draft knowledge base structure', status: 'pending'},
          ],
        }}
      />,
    )
    // One row for the pair, labeled by the step; the differently-titled child is its way in, and
    // never renders again as a loose row.
    expect(container.textContent).not.toContain('Research common health supplements')
    expect(container.textContent).toContain('Research common supplements')
    expect(container.textContent).toContain('Draft knowledge base structure')
  })

  it('renders plan steps and unattached sub-agents as one list, not two stacked blocks', () => {
    // Children spawned before any plan existed have no step to attach to; they still belong in the
    // same checklist container so the card reads as one account of the run.
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Build KB'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeChild({id: 'child-1', status: 'succeeded', title: 'Research supplement knowledge base'}),
    ]
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{
          title: 'Build supplement knowledge base',
          steps: [{id: 's1', label: 'Publish Seed docs', status: 'running'}],
        }}
      />,
    )
    const listWithTitle = Array.from(container.querySelectorAll('div')).find(
      (div) =>
        div.textContent?.includes('Build supplement knowledge base') &&
        div.querySelector('span')?.textContent === 'Build supplement knowledge base',
    )
    expect(listWithTitle?.textContent).toContain('Publish Seed docs')
    expect(listWithTitle?.textContent).toContain('Research supplement knowledge base')
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

  it('renders the checklist carried by the transcript row when the run has none of its own', () => {
    // `RunInfo.plan` is written by the workflow host alone, so a model-driven run's frozen card
    // would show a title and no steps unless the row hands it the session's checklist.
    mockState.run = makeRun({id: 'root-1', status: 'running', title: 'Compare competitors'})
    mockState.tree = [mockState.run]
    render(<RunRecordCard {...recordProps} plan={{steps: [{id: 's1', label: 'Fan out research', status: 'done'}]}} />)

    expect(container.textContent).toContain('Fan out research')
    // The plan can freeze into the scroll while the agent writes its closing answer. At that point
    // it is already a completed record, not another live spinner or cancel surface.
    expect(container.textContent).toContain('Plan complete')
    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(buttonWithText('Cancel')).toBeUndefined()
  })

  it('keeps a successful completed checklist visible and hides recovered issues in run details', () => {
    mockState.run = makeRun({id: 'root-1', status: 'succeeded', title: 'Long raw user prompt', finishedAt: 5_000})
    mockState.tree = [
      mockState.run,
      makeChild({
        id: 'failed-timer',
        status: 'failed',
        kind: 'workflow',
        title: 'First timer attempt',
        error: {code: 'unknown-tool', message: 'Tool was unavailable'},
      }),
      makeChild({id: 'good-timer', status: 'succeeded', kind: 'workflow', title: 'Five-minute timer'}),
    ]
    render(
      <RunRecordCard
        {...recordProps}
        plan={{
          title: 'Madrid weather check',
          steps: [
            {id: 'create', label: 'Create weather tool', status: 'done'},
            {id: 'wait', label: 'Wait five minutes and recheck', status: 'done'},
          ],
        }}
      />,
    )

    expect(container.textContent).toContain('Madrid weather check')
    expect(container.textContent).toContain('Create weather tool')
    expect(container.textContent).toContain('Wait five minutes and recheck')
    expect(container.textContent).toContain('Run details· 1 recovered issue')
    expect(container.textContent).not.toContain('Tool was unavailable')
    expect(container.textContent).not.toContain('First timer attempt')

    click(
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Run details')),
    )
    expect(container.textContent).toContain('Tool was unavailable')
    expect(container.textContent).toContain('First timer attempt')
  })

  it('shows the workflow module behind a Code drawer', () => {
    mockState.run = makeRun({
      id: 'root-1',
      status: 'succeeded',
      kind: 'workflow',
      title: 'Link fixer',
      sourceText: 'export default async function (input, ctx) { return 1 }',
    })
    mockState.tree = [mockState.run]
    render(<RunRecordCard {...recordProps} />)

    // Completed technical details are collapsed by default; source is still available two
    // deliberate disclosures deep, so it cannot dominate the successful transcript.
    expect(container.textContent).not.toContain('export default async function')
    click(
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Run details')),
    )
    click(buttonWithText('Code'))
    expect(container.textContent).toContain('export default async function (input, ctx) { return 1 }')
  })

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
    click(
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Run details')),
    )
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
