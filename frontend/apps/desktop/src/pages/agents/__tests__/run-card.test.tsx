import type {RunInfo} from '@/agents-client'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
// vi.mock calls below are hoisted above this import, so the card gets the mocked hooks.
import {SessionRunCard} from '../run-card'

/**
 * Rendering coverage for the pinned run card.
 *
 * The card is the one surface that makes a long, silent run legible, and its states are driven
 * entirely by durable run data — so these mount it against fixed `RunInfo`s rather than a live
 * server, and assert what the user actually sees in each state.
 */

const mockState = vi.hoisted(() => ({
  runs: [] as RunInfo[],
  tree: [] as RunInfo[],
  cancel: vi.fn(),
}))

vi.mock('@/models/agents', () => ({
  useSessionRuns: () => ({data: mockState.runs}),
  useRunTree: () => ({data: mockState.tree}),
  useAgentRunTreeSubscription: () => ({runs: {}, progress: {}, activity: {}, journal: []}),
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

let container: HTMLDivElement
let root: Root

function render(element: React.ReactElement) {
  act(() => {
    root.render(element)
  })
}

beforeEach(() => {
  mockState.runs = []
  mockState.tree = []
  mockState.cancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SessionRunCard', () => {
  const baseProps = {serverUrl: 'http://localhost:3050', accountUid: 'account-1', sessionId: 'session-1'}

  it('renders nothing without a run or a plan', () => {
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toBe('')
  })

  it('renders the session todo list when there is no run', () => {
    render(
      <SessionRunCard
        {...baseProps}
        sessionPlan={{
          title: 'Ship it',
          steps: [
            {id: 's1', label: 'Draft the doc', status: 'done'},
            {id: 's2', label: 'Review', status: 'running'},
          ],
        }}
      />,
    )
    expect(container.textContent).toContain('Ship it')
    expect(container.textContent).toContain('Draft the doc')
    expect(container.textContent).toContain('Review')
  })

  it('shows an active run with its steps, children and a cancel control', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Compare competitors'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeRun({id: 'child-1', rootRunId: 'root-1', status: 'succeeded', title: 'Research Acme', sessionId: 'child-s1'}),
      makeRun({id: 'child-2', rootRunId: 'root-1', status: 'running', title: 'Research Globex'}),
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
    expect(container.textContent).toContain('Cancel')
  })

  it('asks for confirmation before canceling a run', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'running', title: 'Long job'})]
    mockState.tree = [mockState.runs[0]!]
    render(<SessionRunCard {...baseProps} />)

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    )
    act(() => cancelButton?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(mockState.cancel).not.toHaveBeenCalled()

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel run',
    )
    act(() => confirmButton?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(mockState.cancel).toHaveBeenCalledWith('root-1')
  })

  it('names the sub-sessions a parked run is waiting on', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'waiting', title: 'Parent turn'})]
    mockState.tree = [
      mockState.runs[0]!,
      makeRun({id: 'child-1', rootRunId: 'root-1', status: 'succeeded', title: 'One'}),
      makeRun({id: 'child-2', rootRunId: 'root-1', status: 'running', title: 'Two'}),
    ]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toContain('Waiting on 2 sub-sessions — 1 done')
  })

  it('collapses a finished run to a chip that expands to the full card', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'succeeded', title: 'All done', finishedAt: 5000})]
    mockState.tree = [
      mockState.runs[0]!,
      makeRun({id: 'child-1', rootRunId: 'root-1', status: 'succeeded', title: 'Child'}),
    ]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toContain('All done')
    expect(container.textContent).toContain('1 sub-session')
    expect(container.textContent).not.toContain('Child')

    const chip = container.querySelector('button')
    act(() => chip?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(container.textContent).toContain('Child')
  })

  it('dismisses a finished run for good', () => {
    mockState.runs = [makeRun({id: 'root-1', status: 'succeeded', title: 'All done'})]
    mockState.tree = [mockState.runs[0]!]
    render(<SessionRunCard {...baseProps} />)

    const dismiss = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Dismiss run summary',
    )
    act(() => dismiss?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(container.textContent).toBe('')
  })

  it('surfaces the error message of a failed run', () => {
    mockState.runs = [
      makeRun({id: 'root-1', status: 'failed', title: 'Broken', error: {code: 'tool_failed', message: 'boom'}}),
    ]
    mockState.tree = [mockState.runs[0]!]
    render(<SessionRunCard {...baseProps} />)
    expect(container.textContent).toContain('Failed: boom')
  })
})
