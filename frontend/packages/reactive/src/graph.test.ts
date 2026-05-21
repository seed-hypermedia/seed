import {describe, it, expect, vi, beforeEach} from 'vitest'
import {acquireNode, resetRegistry} from './graph'
import {dispatch, resetEventBus} from './event-bus'

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('graph', () => {
  beforeEach(() => {
    resetRegistry()
    resetEventBus()
  })

  it('runs fetcher on first acquire and stores success state', async () => {
    const fetcher = vi.fn().mockResolvedValue(1)
    const h = acquireNode({key: 'a', topics: ['T'], fetcher})
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(h.state.get()).toMatchObject({status: 'success', value: 1})
    h.release()
  })

  it('refetches on event for matching topic', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    const h = acquireNode({key: 'b', topics: ['T'], fetcher})
    await flush()
    dispatch({topic: 'T'})
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(h.state.get()).toMatchObject({status: 'success', value: 2})
    h.release()
  })

  it('ignores events on non-subscribed topics', async () => {
    const fetcher = vi.fn().mockResolvedValue(1)
    const h = acquireNode({key: 'c', topics: ['T'], fetcher})
    await flush()
    dispatch({topic: 'OTHER'})
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    h.release()
  })

  it('early-cutoff preserves value identity when equals returns true', async () => {
    const sameValue = {x: 1}
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sameValue)
      .mockResolvedValueOnce({x: 1})
    const h = acquireNode({
      key: 'eq',
      topics: ['T'],
      fetcher,
      equals: (a: {x: number}, b: {x: number}) => a.x === b.x,
    })
    await flush()
    const before = h.state.get()
    dispatch({topic: 'T'})
    await flush()
    const after = h.state.get()
    expect(after.value).toBe(sameValue)
    expect(after).toBe(before)
    h.release()
  })

  it('captures error state', async () => {
    const err = new Error('boom')
    const fetcher = vi.fn().mockRejectedValue(err)
    const h = acquireNode({key: 'err', topics: ['T'], fetcher})
    await flush()
    expect(h.state.get()).toMatchObject({status: 'error', error: err})
    h.release()
  })

  it('batches multiple events into a single refetch (microtask tick)', async () => {
    const fetcher = vi.fn().mockResolvedValue(1)
    const h = acquireNode({key: 'batch', topics: ['T'], fetcher})
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    dispatch({topic: 'T'})
    dispatch({topic: 'T'})
    dispatch({topic: 'T'})
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    h.release()
  })

  it('release unsubscribes topics when refcount hits zero', async () => {
    const fetcher = vi.fn().mockResolvedValue(1)
    const h = acquireNode({key: 'rc', topics: ['T'], fetcher})
    await flush()
    h.release()
    dispatch({topic: 'T'})
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('shares one fetch across two acquirers of same key', async () => {
    const fetcher = vi.fn().mockResolvedValue(42)
    const h1 = acquireNode({key: 'shared', topics: ['T'], fetcher})
    const h2 = acquireNode({key: 'shared', topics: ['T'], fetcher})
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(h1.state.get().value).toBe(42)
    expect(h2.state.get().value).toBe(42)
    h1.release()
    h2.release()
  })
})
