// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import {QueryClient} from '@tanstack/react-query'
import {registerQueryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  enqueueWebDocumentCardCleanup,
  dismissWebDocumentCardCleanup,
  clearDismissedWebDocumentCardCleanup,
  getWebDocumentCardCleanupSnapshot,
  getWebDocumentCardCleanupWorkerError,
  resetWebDocumentCardCleanupForTest,
  releaseWebDocumentCardCleanup,
  runNextWebDocumentCleanupJobForTest,
  startWebDocumentCardCleanupCoordinator,
} from './web-document-card-cleanup'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}
afterEach(() => {
  resetWebDocumentCardCleanupForTest()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('durable browser cleanup inbox', () => {
  it('persists dismissed history through the command inbox and clears it without running the job', async () => {
    vi.stubGlobal('navigator', {locks: {request: (_name: string, run: () => Promise<void>) => run()}})
    localStorage.setItem(
      'WebDocumentCardCleanupState-v001',
      JSON.stringify({
        jobs: [
          {
            id: 'history-job',
            sourceDocumentId: 'hm://alice/parent/child',
            parentDocumentId: 'hm://alice/parent',
            signingAccountUid: 'alice',
            state: 'failedNeedsAttention',
            attempts: 4,
            maxRetries: 3,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastError: 'offline',
          },
        ],
      }),
    )
    const request = vi.fn()
    startWebDocumentCardCleanupCoordinator({client: {request} as any})
    await dismissWebDocumentCardCleanup('history-job')
    await runNextWebDocumentCleanupJobForTest()
    await vi.waitFor(() => expect(getWebDocumentCardCleanupSnapshot().jobs[0]?.state).toBe('dismissed'))
    expect(JSON.parse(localStorage.getItem('WebDocumentCardCleanupState-v001')!).jobs[0]).toMatchObject({
      state: 'dismissed',
      lastError: 'offline',
      attempts: 4,
    })
    await clearDismissedWebDocumentCardCleanup()
    await runNextWebDocumentCleanupJobForTest()
    await vi.waitFor(() => expect(getWebDocumentCardCleanupSnapshot().jobs).toEqual([]))
    expect(request).not.toHaveBeenCalled()
  })

  it('refreshes inactive parent caches when another tab completes maintenance', async () => {
    const permit = deferred()
    vi.stubGlobal('navigator', {locks: {request: () => permit.promise}})
    const client = new QueryClient({defaultOptions: {queries: {staleTime: Infinity, refetchOnMount: false}}})
    registerQueryClient(client)
    let version = 'old'
    const entityKey = [queryKeys.ENTITY, 'hm://alice/parent', undefined, false]
    const draftKey = ['web-doc-draft', 'hm://alice/parent', 'alice', null]
    await client.fetchQuery({queryKey: entityKey, queryFn: async () => version})
    await client.fetchQuery({queryKey: draftKey, queryFn: async () => ({deps: [version]})})
    startWebDocumentCardCleanupCoordinator({client: {request: vi.fn()} as any})
    version = 'new'
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'WebDocumentCardCleanupState-v001',
        newValue: JSON.stringify({
          jobs: [
            {
              id: 'job',
              operation: 'add',
              container: {id: 'hm://alice/parent', uid: 'alice', path: ['parent']},
              state: 'done',
              publishedVersion: 'new',
            },
          ],
        }),
      }),
    )
    await vi.waitFor(() => {
      expect(client.getQueryData(entityKey)).toBe('new')
      expect(client.getQueryData(draftKey)).toEqual({deps: ['new']})
    })
    client.clear()
    permit.resolve()
  })

  it('persists concurrent intents without waiting for worker ownership, then drains them', async () => {
    const permit = deferred()
    let tail = permit.promise
    const locks = {
      request: (_name: string, run: () => Promise<void>) => {
        const result = tail.then(run)
        tail = result.catch(() => {})
        return result
      },
    }
    vi.stubGlobal('navigator', {locks})
    const request = vi.fn().mockResolvedValue({type: 'not-found'})
    const deps = {client: {request: request as any}}
    startWebDocumentCardCleanupCoordinator(deps)
    await Promise.all([
      enqueueWebDocumentCardCleanup({deletedDocumentId: 'hm://alice/one', signingAccountUid: 'alice'}, deps),
      enqueueWebDocumentCardCleanup({deletedDocumentId: 'hm://alice/two', signingAccountUid: 'alice'}, deps),
    ])
    expect(request).not.toHaveBeenCalled()
    expect(Object.keys(localStorage).filter((key) => key.startsWith('WebDocumentCardCleanupCommand-'))).toHaveLength(2)
    permit.resolve()
    await runNextWebDocumentCleanupJobForTest()
    await runNextWebDocumentCleanupJobForTest()
    expect(Object.keys(localStorage).filter((key) => key.startsWith('WebDocumentCardCleanupCommand-'))).toHaveLength(0)
    const snapshot = getWebDocumentCardCleanupSnapshot()
    expect(snapshot.jobs).toHaveLength(2)
    expect(snapshot.jobs.every((job) => job.state === 'skippedTerminal')).toBe(true)
  })
  it('preserves enqueue-before-release causality at an identical clock time', async () => {
    const permit = deferred()
    let tail = permit.promise
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, run: () => Promise<void>) => {
          const result = tail.then(run)
          tail = result.catch(() => {})
          return result
        },
      },
    })
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    const deps = {client: {request: vi.fn().mockResolvedValue({type: 'not-found'}) as any}}
    startWebDocumentCardCleanupCoordinator(deps)
    const job = await enqueueWebDocumentCardCleanup(
      {
        deletedDocumentId: 'hm://alice/one',
        signingAccountUid: 'alice',
        awaitingPrimary: {documentId: 'hm://alice/one', expectedType: 'tombstone'},
      },
      deps,
    )
    expect(job.jobId).toBeTruthy()
    await releaseWebDocumentCardCleanup(job.jobId!)
    const keys = Object.keys(localStorage)
      .filter((key) => key.startsWith('WebDocumentCardCleanupCommand-'))
      .sort()
    expect(keys.map((key) => JSON.parse(localStorage.getItem(key)!).type)).toEqual([
      'cleanup.enqueue',
      'cleanup.release',
    ])
    permit.resolve()
    await runNextWebDocumentCleanupJobForTest()
    expect(getWebDocumentCardCleanupSnapshot().jobs[0]?.primaryConfirmed).toBe(true)
    expect(getWebDocumentCardCleanupSnapshot().jobs[0]?.state).toBe('skippedTerminal')
  })
  it('retains commands and publishes nothing when durable queue storage fails', async () => {
    const permit = deferred()
    let tail = permit.promise
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, run: () => Promise<void>) => {
          const result = tail.then(run)
          tail = result.catch(() => {})
          return result
        },
      },
    })
    const request = vi.fn().mockResolvedValue({type: 'not-found'})
    const deps = {client: {request: request as any}}
    startWebDocumentCardCleanupCoordinator(deps)
    await enqueueWebDocumentCardCleanup({deletedDocumentId: 'hm://alice/one', signingAccountUid: 'alice'}, deps)
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.includes('CleanupState')) throw new Error('Storage quota exceeded')
      original.call(this, key, value)
    })
    permit.resolve()
    await runNextWebDocumentCleanupJobForTest()
    expect(request).not.toHaveBeenCalled()
    expect(getWebDocumentCardCleanupWorkerError()).toBe('Storage quota exceeded')
    expect(Object.keys(localStorage).filter((key) => key.startsWith('WebDocumentCardCleanupCommand-'))).toHaveLength(1)
  })
  it('fails closed without Web Locks but retains follow-up intent', async () => {
    vi.stubGlobal('navigator', {})
    const request = vi.fn()
    const deps = {client: {request: request as any}}
    expect(() => startWebDocumentCardCleanupCoordinator(deps)).toThrow('Web Locks')
    await enqueueWebDocumentCardCleanup({deletedDocumentId: 'hm://alice/one', signingAccountUid: 'alice'}, deps)
    expect(request).not.toHaveBeenCalled()
    expect(Object.keys(localStorage).filter((key) => key.startsWith('WebDocumentCardCleanupCommand-'))).toHaveLength(1)
  })
})
