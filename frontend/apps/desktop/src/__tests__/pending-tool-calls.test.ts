import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createPendingToolCalls} from '../plugins/pending-tool-calls'

describe('createPendingToolCalls', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves a request with its result', async () => {
    const calls = createPendingToolCalls(1000)
    const promise = calls.request('a')
    expect(calls.has('a')).toBe(true)
    expect(calls.size()).toBe(1)
    calls.resolve('a', {ok: true})
    await expect(promise).resolves.toEqual({ok: true})
    // settling removes the entry
    expect(calls.has('a')).toBe(false)
    expect(calls.size()).toBe(0)
  })

  it('rejects a request with an error message', async () => {
    const calls = createPendingToolCalls(1000)
    const promise = calls.request('b')
    calls.reject('b', 'boom')
    await expect(promise).rejects.toThrow('boom')
    expect(calls.has('b')).toBe(false)
  })

  it('auto-rejects after the timeout elapses', async () => {
    const calls = createPendingToolCalls(1000)
    const promise = calls.request('c')
    const assertion = expect(promise).rejects.toThrow('timed out after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(calls.has('c')).toBe(false)
  })

  it('does not reject before the timeout', async () => {
    const calls = createPendingToolCalls(1000)
    const promise = calls.request('c2')
    await vi.advanceTimersByTimeAsync(999)
    expect(calls.has('c2')).toBe(true)
    calls.resolve('c2', 42)
    await expect(promise).resolves.toBe(42)
  })

  it('ignores resolve/reject for unknown or already-settled ids (no double-settle)', async () => {
    const calls = createPendingToolCalls(1000)
    const promise = calls.request('d')
    calls.resolve('d', 'first')
    // these must be no-ops, not throw or change the settled value
    expect(() => calls.resolve('d', 'second')).not.toThrow()
    expect(() => calls.reject('d', 'late error')).not.toThrow()
    expect(() => calls.resolve('never', 'x')).not.toThrow()
    await expect(promise).resolves.toBe('first')
  })

  it('a timed-out request ignores a late result', async () => {
    const calls = createPendingToolCalls(500)
    const promise = calls.request('e')
    const assertion = expect(promise).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(500)
    await assertion
    // late renderer reply must not throw
    expect(() => calls.resolve('e', 'too late')).not.toThrow()
  })

  it('rejects a duplicate request id without disturbing the original', async () => {
    const calls = createPendingToolCalls(1000)
    const first = calls.request('dup')
    const second = calls.request('dup')
    await expect(second).rejects.toThrow('Duplicate plugin tool request id: dup')
    // the original is still live and settles normally
    calls.resolve('dup', 'ok')
    await expect(first).resolves.toBe('ok')
  })

  it('clear() rejects all in-flight requests', async () => {
    const calls = createPendingToolCalls(1000)
    const a = calls.request('a')
    const b = calls.request('b')
    calls.clear('shutting down')
    await expect(a).rejects.toThrow('shutting down')
    await expect(b).rejects.toThrow('shutting down')
    expect(calls.size()).toBe(0)
  })
})
