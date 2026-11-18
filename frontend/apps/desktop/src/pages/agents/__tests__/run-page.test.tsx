import type {RunInfo} from '@shm/ui/agents/client'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
// vi.mock calls below are hoisted above this import, so the page gets the mocked hooks.
import AgentRunRoutePage from '@shm/ui/agents/run'

/**
 * The run page only ever shows a run that has no transcript.
 *
 * A run with a session is read in that session, so its address hands over to the session page;
 * a script, which has none, keeps its page. These mount the route page against fixed `RunInfo`s
 * and assert where the address ends up.
 */

const mockState = vi.hoisted(() => ({
  run: null as RunInfo | null,
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('@shm/ui/agents/navigation', () => ({
  useNavigate: (mode?: string) => (mode === 'replace' ? mockState.replace : mockState.push),
  useClickNavigate: () => vi.fn(),
  useOpenUrl: () => vi.fn(),
  resolveHypermediaRoute: () => null,
}))

vi.mock('@shm/shared/utils/navigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavRoute: () => ({key: 'agent-run', runId: 'run-1', serverUrl: 'http://localhost:3050'}),
}))

vi.mock('@shm/ui/agents/account', () => ({
  useSelectedAccountId: () => 'account-1',
}))

vi.mock('@shm/ui/agents/header', () => ({
  AgentBreadcrumb: () => null,
}))

vi.mock('@shm/ui/agents/markdown', () => ({
  Markdown: ({children}: {children: React.ReactNode}) => React.createElement('div', null, children),
}))

vi.mock('@shm/ui/agents/models', () => ({
  getDefaultAgentServerUrl: () => 'http://localhost:3050',
  useAgentServerUrl: () => ({data: 'http://localhost:3050'}),
  useAgentDetail: () => ({data: undefined}),
  useRun: () => ({data: mockState.run, isLoading: false, isError: false}),
  useRunTree: () => ({data: mockState.run ? [mockState.run] : []}),
  useAgentRunTreeSubscription: () => ({runs: {}, progress: {}, activity: {}, journal: []}),
  useCancelRun: () => ({mutate: vi.fn(), isPending: false}),
  useSignalRun: () => ({mutate: vi.fn(), isPending: false}),
}))

function makeRun(overrides: Partial<RunInfo>): RunInfo {
  return {
    id: 'run-1',
    account: 'account-1',
    rootRunId: 'run-1',
    depth: 0,
    kind: 'agent',
    origin: 'agent',
    status: 'succeeded',
    title: 'Find the reproduction setup',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  } as RunInfo
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mockState.run = null
  mockState.push = vi.fn()
  mockState.replace = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AgentRunRoutePage', () => {
  it('hands a run that has a transcript over to its session, replacing the run address', () => {
    mockState.run = makeRun({sessionId: 'session-1', agentId: 'hm://agent/ion'})
    act(() => root.render(<AgentRunRoutePage />))

    expect(mockState.replace).toHaveBeenCalledWith({
      key: 'agent-session',
      sessionId: 'session-1',
      agentId: 'hm://agent/ion',
      serverUrl: 'http://localhost:3050',
    })
    // Back must leave the run's address, not bounce off it.
    expect(mockState.push).not.toHaveBeenCalled()
    // The record never flashes on the way: no title, and no claim that the run is missing.
    expect(container.textContent).not.toContain('Find the reproduction setup')
    expect(container.textContent).not.toContain('Run not found')
  })

  it('keeps the page for a script, which has no transcript to go to', () => {
    mockState.run = makeRun({kind: 'workflow', origin: 'workflow', title: 'Import script'})
    act(() => root.render(<AgentRunRoutePage />))

    expect(mockState.replace).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Import script')
    expect(container.textContent).toContain('started by a script')
  })
})
