import {describe, expect, it, vi} from 'vitest'
import {createWebCleanupWorker} from './web-cleanup-worker'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}
function lockManager() {
  let tail = Promise.resolve()
  return {
    request: (_name: string, run: () => Promise<void>) => {
      const result = tail.then(run)
      tail = result.catch(() => {})
      return result
    },
  } as Pick<LockManager, 'request'>
}
describe('exclusive web cleanup worker', () => {
  it('serializes tabs and hydrates only after acquiring ownership', async () => {
    const locks = lockManager()
    const entered = deferred()
    const release = deferred()
    const reads: number[] = []
    let persistedVersion = 0
    const first = createWebCleanupWorker({
      locks,
      onError: vi.fn(),
      run: async () => {
        reads.push(persistedVersion)
        entered.resolve()
        await release.promise
        persistedVersion = 1
      },
    })
    const second = createWebCleanupWorker({
      locks,
      onError: vi.fn(),
      run: async () => {
        reads.push(persistedVersion)
        persistedVersion = 2
      },
    })
    const one = first.wake()
    await entered.promise
    const two = second.wake()
    expect(reads).toEqual([0])
    release.resolve()
    await Promise.all([one, two])
    expect(reads).toEqual([0, 1])
    expect(persistedVersion).toBe(2)
  })
  it('hands off the lock after failures and reports them', async () => {
    const locks = lockManager()
    const error = new Error('Storage unavailable')
    const onError = vi.fn()
    const first = createWebCleanupWorker({
      locks,
      onError,
      run: async () => {
        throw error
      },
    })
    const recovered = vi.fn().mockResolvedValue(undefined)
    const second = createWebCleanupWorker({locks, onError: vi.fn(), run: recovered})
    await Promise.all([first.wake(), second.wake()])
    expect(onError).toHaveBeenCalledWith(error)
    expect(recovered).toHaveBeenCalledOnce()
  })
  it('does not lose commands arriving while a session is running', async () => {
    const entered = deferred()
    const release = deferred()
    const run = vi
      .fn()
      .mockImplementationOnce(async () => {
        entered.resolve()
        await release.promise
      })
      .mockResolvedValue(undefined)
    const worker = createWebCleanupWorker({locks: lockManager(), onError: vi.fn(), run})
    const pending = worker.wake()
    await entered.promise
    worker.wake()
    release.resolve()
    await pending
    expect(run).toHaveBeenCalledTimes(2)
  })
})
