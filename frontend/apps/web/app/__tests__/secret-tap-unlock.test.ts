import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {createSecretTapUnlock} from '../secret-tap-unlock'

describe('createSecretTapUnlock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onUnlock after exactly requiredTaps taps within the window', () => {
    const onUnlock = vi.fn()
    const {tap} = createSecretTapUnlock({requiredTaps: 3, windowMs: 1000, onUnlock})

    tap()
    tap()
    expect(onUnlock).not.toHaveBeenCalled()

    tap()
    expect(onUnlock).toHaveBeenCalledOnce()
  })

  it('resets counter when taps are too slow (window expires)', () => {
    const onUnlock = vi.fn()
    const {tap} = createSecretTapUnlock({requiredTaps: 3, windowMs: 1000, onUnlock})

    tap()
    tap()
    vi.advanceTimersByTime(1500) // window expired
    tap()
    expect(onUnlock).not.toHaveBeenCalled()

    // need 3 more from scratch
    tap()
    tap()
    expect(onUnlock).toHaveBeenCalledOnce()
  })

  it('ignores taps after unlock', () => {
    const onUnlock = vi.fn()
    const {tap} = createSecretTapUnlock({requiredTaps: 2, windowMs: 1000, onUnlock})

    tap()
    tap()
    expect(onUnlock).toHaveBeenCalledOnce()

    // further taps are no-ops
    tap()
    tap()
    expect(onUnlock).toHaveBeenCalledOnce()
  })

  it('resets window timer on each tap', () => {
    const onUnlock = vi.fn()
    const {tap} = createSecretTapUnlock({requiredTaps: 3, windowMs: 1000, onUnlock})

    tap()
    vi.advanceTimersByTime(800)
    tap()
    vi.advanceTimersByTime(800) // 1600ms total, but only 800ms since last tap
    tap()
    expect(onUnlock).toHaveBeenCalledOnce()
  })

  it('dispose clears pending timeout', () => {
    const onUnlock = vi.fn()
    const {tap, dispose} = createSecretTapUnlock({requiredTaps: 3, windowMs: 1000, onUnlock})

    tap()
    tap()
    dispose()

    // advancing time should not cause issues
    vi.advanceTimersByTime(2000)
    expect(onUnlock).not.toHaveBeenCalled()
  })
})
