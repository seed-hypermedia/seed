// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  universalClient: {request: async () => {}},
  loadCandidates: [
    {
      id: {id: 'hm://alice/about', path: [], version: null, latest: true, blockRef: null, blockRange: null},
      title: 'About',
    },
    {
      id: {id: 'hm://alice/projects', path: [], version: null, latest: true, blockRef: null, blockRange: null},
      title: 'Projects',
    },
    {
      id: {id: 'hm://alice/blog', path: [], version: null, latest: true, blockRef: null, blockRange: null},
      title: 'Blog',
    },
  ] as any[],
  enqueueCalls: [] as any[],
  enqueueResult: {enqueued: true, jobId: 'job-1'},
  retryCalls: [] as any[],
  setSiteRecordCalls: [] as any[],
  snapshotJobs: [] as any[],
  toastCalls: [] as string[],
  invalidateCalls: [] as any[],
}))

vi.mock('@/trpc', () => ({
  client: {
    documentCardCleanup: {
      enqueue: {
        mutate: (input: any) => {
          state.enqueueCalls.push(input)
          return Promise.resolve(state.enqueueResult)
        },
      },
      retry: {
        mutate: (input: any) => {
          state.retryCalls.push(input)
          return Promise.resolve(null)
        },
      },
      getSnapshot: {
        query: () => Promise.resolve({jobs: state.snapshotJobs}),
      },
    },
    shapeHome: {
      setSiteRecord: {
        mutate: (input: any) => {
          state.setSiteRecordCalls.push(input)
          return Promise.resolve(null)
        },
      },
    },
  },
}))

vi.mock('@shm/shared', () => ({
  useUniversalAppContext: () => ({universalClient: state.universalClient}),
  hmId: (uid: string) => ({
    id: `hm://${uid}`,
    uid,
    path: [],
    version: null,
    latest: true,
    blockRef: null,
    blockRange: null,
  }),
}))

vi.mock('@shm/shared/utils/shape-home', () => ({
  loadShapeHomeStatus: async (_client: any, _uid: string) => ({
    eligible: true,
    firstPublishedAt: 1000,
    candidates: state.loadCandidates,
  }),
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: (key: any) => state.invalidateCalls.push(key),
}))

vi.mock('@shm/shared/models/query-keys', () => ({
  queryKeys: {ENTITY: 'ENTITY', RESOLVED_ENTITY: 'RESOLVED_ENTITY', DOC_LIST_DIRECTORY: 'DOC_LIST_DIRECTORY'},
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {success: (msg: string) => state.toastCalls.push(msg)},
}))

vi.mock('@shm/ui/shape-home-helper', () => {
  const ShapeHomeHelper = ({
    state: helperState,
    candidates,
    selected,
    showAll,
    error,
    onToggle,
    onShowMore,
    onAdd,
    onRetry,
    onNotNow,
  }: any) => {
    const visible = showAll ? candidates : candidates.slice(0, 12)
    const disabled = helperState === 'adding' || helperState === 'loading'
    const addDisabled = disabled || selected.size === 0
    return (
      <div data-testid="helper" data-state={helperState} data-error={error || ''}>
        <div data-testid="candidates">
          {visible.map((c: any) => (
            <button key={c.id} data-id={c.id} data-pressed={selected.has(c.id)} onClick={() => onToggle(c.id)}>
              {c.title}
            </button>
          ))}
        </div>
        {candidates.length > 12 && !showAll ? (
          <button data-testid="show-more" onClick={onShowMore}>
            Show {candidates.length - 12} more
          </button>
        ) : null}
        <button data-testid="add" onClick={onAdd} disabled={addDisabled}>
          {selected.size === candidates.length && candidates.length > 0
            ? 'Add all to Home'
            : `Add ${selected.size} to Home`}
        </button>
        <button data-testid="retry" onClick={onRetry}>
          Retry
        </button>
        <button data-testid="not-now" onClick={onNotNow}>
          Not now
        </button>
      </div>
    )
  }
  return {ShapeHomeHelper}
})

import {DesktopShapeHomeHelper} from '../shape-home-helper'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null

function render(record?: any) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({defaultOptions: {queries: {staleTime: Infinity, retry: false}}})
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient!}>
        <DesktopShapeHomeHelper uid="alice" record={record} />
      </QueryClientProvider>,
    )
  })
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function settle() {
  await act(async () => {
    await flushPromises()
  })
  await act(async () => {
    await flushPromises()
  })
}

async function refreshSnapshot() {
  await act(async () => {
    await queryClient!.invalidateQueries({queryKey: ['trpc.documentCardCleanup.getSnapshot']})
    await flushPromises()
  })
  await act(async () => {
    await flushPromises()
  })
}

beforeEach(() => {
  state.enqueueCalls = []
  state.enqueueResult = {enqueued: true, jobId: 'job-1'}
  state.retryCalls = []
  state.setSiteRecordCalls = []
  state.snapshotJobs = []
  state.toastCalls = []
  state.invalidateCalls = []
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function pill(id: string) {
  return document.body.querySelector(`button[data-id="${id}"]`) as HTMLButtonElement
}

describe('DesktopShapeHomeHelper', () => {
  it('renders pills selected by default after load', async () => {
    render()
    await settle()
    expect(document.body.querySelector('[data-testid="helper"]')?.getAttribute('data-state')).toBe('choosing')
    expect(pill('hm://alice/about')?.getAttribute('data-pressed')).toBe('true')
    expect(pill('hm://alice/projects')?.getAttribute('data-pressed')).toBe('true')
    expect(pill('hm://alice/blog')?.getAttribute('data-pressed')).toBe('true')
  })

  it('toggle deselects a pill', async () => {
    render()
    await settle()
    act(() => pill('hm://alice/about')!.click())
    expect(pill('hm://alice/about')?.getAttribute('data-pressed')).toBe('false')
    expect(pill('hm://alice/projects')?.getAttribute('data-pressed')).toBe('true')
  })

  it('Add all to Home label when all selected; Add N to Home otherwise; disabled at 0', async () => {
    render()
    await settle()
    const add = document.body.querySelector('[data-testid="add"]') as HTMLButtonElement
    expect(add.textContent).toBe('Add all to Home')
    expect(add.disabled).toBe(false)

    // Deselect all
    act(() => pill('hm://alice/about')!.click())
    act(() => pill('hm://alice/projects')!.click())
    act(() => pill('hm://alice/blog')!.click())
    const addAfter = document.body.querySelector('[data-testid="add"]') as HTMLButtonElement
    expect(addAfter.textContent).toBe('Add 0 to Home')
    expect(addAfter.disabled).toBe(true)

    // Reselect one
    act(() => pill('hm://alice/about')!.click())
    const addOne = document.body.querySelector('[data-testid="add"]') as HTMLButtonElement
    expect(addOne.textContent).toBe('Add 1 to Home')
    expect(addOne.disabled).toBe(false)
  })

  it('Add enqueues add-cards with selected ids in candidate order; job done → setSiteRecord shaped + toast', async () => {
    render()
    await settle()
    // Deselect the middle one so we test order + subset
    act(() => pill('hm://alice/projects')!.click())
    act(() => (document.body.querySelector('[data-testid="add"]') as HTMLButtonElement).click())
    await settle()

    expect(state.enqueueCalls).toHaveLength(1)
    expect(state.enqueueCalls[0]).toMatchObject({
      operation: 'add-cards',
      parentDocumentId: 'hm://alice',
      signingAccountUid: 'alice',
    })
    expect(state.enqueueCalls[0].targetDocumentIds).toEqual(['hm://alice/about', 'hm://alice/blog'])

    // Simulate the snapshot showing the job done with 2 added, 0 skipped
    state.snapshotJobs = [
      {id: 'job-1', state: 'done', addedTargetIds: ['hm://alice/about', 'hm://alice/blog'], skippedTargetIds: []},
    ]
    await refreshSnapshot()

    const shapedCall = state.setSiteRecordCalls.find((c) => c.record.status === 'shaped')
    expect(shapedCall).toBeTruthy()
    expect(shapedCall).toMatchObject({uid: 'alice'})
    expect(state.toastCalls).toEqual(['Added 2 pages to Home'])
  })

  it('job with skipped targets toasts "Added N of M pages to Home"', async () => {
    render()
    await settle()
    act(() => (document.body.querySelector('[data-testid="add"]') as HTMLButtonElement).click())
    await settle()
    state.snapshotJobs = [
      {
        id: 'job-1',
        state: 'done',
        addedTargetIds: ['hm://alice/about'],
        skippedTargetIds: ['hm://alice/projects', 'hm://alice/blog'],
      },
    ]
    await refreshSnapshot()
    expect(state.toastCalls).toEqual(['Added 1 of 3 pages to Home'])
  })

  it('job failedNeedsAttention → error + Retry calls documentCardCleanup.retry', async () => {
    render()
    await settle()
    act(() => (document.body.querySelector('[data-testid="add"]') as HTMLButtonElement).click())
    await settle()
    state.snapshotJobs = [{id: 'job-1', state: 'failedNeedsAttention', lastError: 'boom'}]
    await refreshSnapshot()
    expect(document.body.querySelector('[data-testid="helper"]')?.getAttribute('data-state')).toBe('failed')
    expect(document.body.querySelector('[data-testid="helper"]')?.getAttribute('data-error')).toBe('boom')
    act(() => (document.body.querySelector('[data-testid="retry"]') as HTMLButtonElement).click())
    await settle()
    expect(state.retryCalls).toEqual([{jobId: 'job-1'}])
  })

  it('Not now → setSiteRecord dismissed', async () => {
    render()
    await settle()
    act(() => (document.body.querySelector('[data-testid="not-now"]') as HTMLButtonElement).click())
    await settle()
    expect(state.setSiteRecordCalls).toHaveLength(1)
    expect(state.setSiteRecordCalls[0]).toMatchObject({uid: 'alice'})
    expect(state.setSiteRecordCalls[0].record.status).toBe('dismissed')
  })
})
