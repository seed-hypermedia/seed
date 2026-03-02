import {describe, expect, it, vi, beforeEach} from 'vitest'
import {setNavigationGuard, clearNavigationGuard, getNavigationGuard, ROUTE_CHANGING_ACTIONS} from '../navigation-guard'

describe('navigation guard', () => {
  beforeEach(() => {
    clearNavigationGuard()
  })

  it('should be null by default', () => {
    expect(getNavigationGuard()).toBeNull()
  })

  it('should set and retrieve a guard', () => {
    const guard = vi.fn().mockReturnValue(true)
    setNavigationGuard(guard)
    expect(getNavigationGuard()).toBe(guard)
  })

  it('should clear the guard', () => {
    const guard = vi.fn().mockReturnValue(true)
    setNavigationGuard(guard)
    clearNavigationGuard()
    expect(getNavigationGuard()).toBeNull()
  })

  it('should replace the guard when set again', () => {
    const guard1 = vi.fn().mockReturnValue(true)
    const guard2 = vi.fn().mockReturnValue(false)
    setNavigationGuard(guard1)
    setNavigationGuard(guard2)
    expect(getNavigationGuard()).toBe(guard2)
  })

  it('should include all route-changing action types', () => {
    expect(ROUTE_CHANGING_ACTIONS.has('push')).toBe(true)
    expect(ROUTE_CHANGING_ACTIONS.has('replace')).toBe(true)
    expect(ROUTE_CHANGING_ACTIONS.has('backplace')).toBe(true)
    expect(ROUTE_CHANGING_ACTIONS.has('pop')).toBe(true)
    expect(ROUTE_CHANGING_ACTIONS.has('forward')).toBe(true)
    expect(ROUTE_CHANGING_ACTIONS.has('closeBack')).toBe(true)
  })

  it('guard can block navigation by returning false', () => {
    const proceed = vi.fn()
    const guard = vi.fn((_action: any, _proceed: any) => false)
    setNavigationGuard(guard)

    const action = {type: 'push', route: {key: 'document', id: 'test'}}
    const result = getNavigationGuard()!(action as any, proceed)

    expect(result).toBe(false)
    expect(proceed).not.toHaveBeenCalled()
  })

  it('guard can allow navigation by returning true', () => {
    const proceed = vi.fn()
    const guard = vi.fn((_action: any, _proceed: any) => true)
    setNavigationGuard(guard)

    const action = {type: 'push', route: {key: 'document', id: 'test'}}
    const result = getNavigationGuard()!(action as any, proceed)

    expect(result).toBe(true)
  })

  it('cancel scenario: guard stores proceed callback, cancel discards it without navigating', () => {
    // Simulates the draft page cancel behavior:
    // 1. Guard blocks navigation and stores the proceed callback
    // 2. User cancels -> stored proceed is discarded (never called)
    let storedProceed: (() => void) | null = null
    const guard = vi.fn((_action: any, proceed: () => void) => {
      storedProceed = proceed
      return false
    })
    setNavigationGuard(guard)

    const proceed = vi.fn()
    getNavigationGuard()!({type: 'push', route: {key: 'document', id: 'test'}} as any, proceed)

    expect(storedProceed).not.toBeNull()

    // Cancel: discard stored proceed without calling it
    storedProceed = null
    expect(proceed).not.toHaveBeenCalled()
  })

  it('save scenario: guard stores proceed callback, user calls proceed to navigate', () => {
    let storedProceed: (() => void) | null = null
    const guard = vi.fn((_action: any, proceed: () => void) => {
      storedProceed = proceed
      return false
    })
    setNavigationGuard(guard)

    const proceed = vi.fn()
    getNavigationGuard()!({type: 'push', route: {key: 'document', id: 'test'}} as any, proceed)

    // Save: call stored proceed
    storedProceed!()
    expect(proceed).toHaveBeenCalledOnce()
  })
})
