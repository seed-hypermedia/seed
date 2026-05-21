import {describe, it, expect, vi, beforeEach} from 'vitest'
import {dispatch, onEvent, listSubscribedTopics, resetEventBus} from './event-bus'

describe('event-bus', () => {
  beforeEach(() => {
    resetEventBus()
  })

  it('delivers events to exact topic listeners', () => {
    const fn = vi.fn()
    const unsub = onEvent('A', fn)
    dispatch({topic: 'A'})
    expect(fn).toHaveBeenCalledTimes(1)
    dispatch({topic: 'B'})
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('delivers all events to wildcard listeners', () => {
    const fn = vi.fn()
    onEvent('*', fn)
    dispatch({topic: 'A'})
    dispatch({topic: 'B'})
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('unsubscribe cleans up listeners and topic map', () => {
    const fn = vi.fn()
    const unsub = onEvent('A', fn)
    expect(listSubscribedTopics()).toContain('A')
    unsub()
    expect(listSubscribedTopics()).not.toContain('A')
    dispatch({topic: 'A'})
    expect(fn).not.toHaveBeenCalled()
  })

  it('forwards hint payload', () => {
    const fn = vi.fn()
    onEvent('A', fn)
    dispatch({topic: 'A', hint: {x: 1}})
    expect(fn).toHaveBeenCalledWith({topic: 'A', hint: {x: 1}})
  })
})
