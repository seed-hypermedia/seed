// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  gate: {} as any,
  jobs: [] as any[],
  enqueue: vi.fn(),
  retry: vi.fn(async () => {}),
  toast: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('../use-web-shape-home-gate', () => ({useWebShapeHomeGate: () => mocks.gate}))
vi.mock('../../universal-client', () => ({webUniversalClient: {request: vi.fn()}}))
vi.mock('../../document-edit/web-document-card-cleanup', () => ({
  enqueueWebDocumentCardCleanup: mocks.enqueue,
  retryWebDocumentCardCleanup: mocks.retry,
  getWebDocumentCardCleanupSnapshot: () => ({jobs: mocks.jobs}),
}))
vi.mock('@shm/shared/utils/shape-home', () => ({
  loadShapeHomeStatus: async () => ({eligible: true, firstPublishedAt: 1, candidates}),
}))
vi.mock('@shm/shared/models/query-client', () => ({invalidateQueries: mocks.invalidate}))
vi.mock('@shm/ui/toast', () => ({toast: {success: mocks.toast, error: vi.fn()}}))
vi.mock('@shm/ui/shape-home-helper', () => ({
  ShapeHomeHelper: ({state, candidates, selected, error, onToggle, onAdd, onRetry, onNotNow}: any) => (
    <div data-testid="helper" data-state={state}>
      {candidates.map((c: any) => (
        <button key={c.id} aria-pressed={selected.has(c.id)} onClick={() => onToggle(c.id)}>
          {c.title}
        </button>
      ))}
      {error ? <p data-testid="error">{error}</p> : null}
      <button onClick={onAdd}>Add</button>
      <button onClick={onRetry}>Retry</button>
      <button onClick={onNotNow}>Not now</button>
    </div>
  ),
}))

import {WebShapeHomeHelper} from '../shape-home-helper'
import {readShapeHomeState, writeShapeHomeState} from '../store'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const candidates = ['Agenda de Ocio', 'Con Historia', 'Noticias'].map((title, i) => ({
  id: {uid: 'z6Mksite', id: `hm://z6Mksite/p${i}`, path: [`p${i}`]},
  title,
}))

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <WebShapeHomeHelper />
      </QueryClientProvider>,
    )
  })
  await flush()
}

async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!
  await act(async () => button.click())
  await flush()
}

async function publishJobs(jobs: any[]) {
  mocks.jobs = jobs
  await act(async () => {
    await queryClient.refetchQueries({queryKey: ['web-document-card-cleanup']})
  })
  await flush()
}

beforeEach(() => {
  localStorage.clear()
  writeShapeHomeState({sites: {}})
  mocks.jobs = []
  mocks.enqueue.mockReset().mockResolvedValue({enqueued: true, jobId: 'job-1'})
  mocks.retry.mockClear()
  mocks.toast.mockClear()
  mocks.gate = {uid: 'z6Mksite', eligible: true, record: undefined, status: {eligible: true, candidates}}
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WebShapeHomeHelper', () => {
  it('renders nothing when the gate is closed and nothing is being added', async () => {
    mocks.gate = {...mocks.gate, eligible: false}
    await render()
    expect(container.querySelector('[data-testid="helper"]')).toBeNull()
  })

  it('adds the selected pages in one add-cards job and records the site as shaped', async () => {
    await render()
    await click('Con Historia')
    await click('Add')
    expect(mocks.enqueue).toHaveBeenCalledWith(
      {
        operation: 'add-cards',
        parentDocumentId: 'hm://z6Mksite',
        targetDocumentIds: ['hm://z6Mksite/p0', 'hm://z6Mksite/p2'],
        signingAccountUid: 'z6Mksite',
      },
      expect.anything(),
    )
    expect(readShapeHomeState().sites.z6Mksite).toEqual({status: 'adding', jobId: 'job-1'})

    await publishJobs([
      {id: 'job-1', state: 'done', addedTargetIds: ['hm://z6Mksite/p0', 'hm://z6Mksite/p2'], skippedTargetIds: []},
    ])
    expect(readShapeHomeState().sites.z6Mksite).toEqual({status: 'shaped'})
    expect(mocks.toast).toHaveBeenCalledWith('Added 2 pages to Home')
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it('shows the failure and retries the same job', async () => {
    await render()
    await click('Add')
    await publishJobs([{id: 'job-1', state: 'failedNeedsAttention', lastError: 'Network down'}])
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe('Network down')
    await click('Retry')
    expect(mocks.retry).toHaveBeenCalledWith('job-1')
  })

  it('Not now records the site as dismissed', async () => {
    await render()
    await click('Not now')
    expect(readShapeHomeState().sites.z6Mksite).toEqual({status: 'dismissed'})
  })
})
