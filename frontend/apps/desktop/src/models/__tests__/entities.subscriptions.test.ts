import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

// vi.mock is hoisted, so its factory is evaluated before the rest of this file
// runs. Declare the mock fns via vi.hoisted so they are available to the
// factory while still being stable references the test cases can reset.
const {subscribeMock, discoveryStateSubscribeMock, focusHandlers} = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  discoveryStateSubscribeMock: vi.fn(),
  focusHandlers: [] as Array<(focused: boolean) => void>,
}))

vi.mock('@/grpc-client', () => ({grpcClient: {}}))

vi.mock('@/trpc', () => ({
  client: {
    sync: {
      subscribe: {subscribe: subscribeMock},
      discoveryState: {subscribe: discoveryStateSubscribeMock},
    },
  },
}))

vi.mock('../documents', () => ({usePushResource: () => vi.fn()}))

vi.mock('../window-focus', () => ({
  isThisWindowFocused: () => true,
  onThisWindowFocusChange: (handler: (focused: boolean) => void) => {
    focusHandlers.push(handler)
    return () => {
      const idx = focusHandlers.indexOf(handler)
      if (idx >= 0) focusHandlers.splice(idx, 1)
    }
  },
}))

import {addSubscribedEntity, cleanupAllEntitySubscriptions, removeSubscribedEntity} from '../entities'

type Handle = {unsubscribe: ReturnType<typeof vi.fn>}

describe('entity subscription dedup', () => {
  let daemonHandles: Handle[]
  let discoveryHandles: Handle[]

  beforeEach(() => {
    cleanupAllEntitySubscriptions()
    subscribeMock.mockReset()
    discoveryStateSubscribeMock.mockReset()
    daemonHandles = []
    discoveryHandles = []
    subscribeMock.mockImplementation(() => {
      const handle: Handle = {unsubscribe: vi.fn()}
      daemonHandles.push(handle)
      return handle
    })
    discoveryStateSubscribeMock.mockImplementation(() => {
      const handle: Handle = {unsubscribe: vi.fn()}
      discoveryHandles.push(handle)
      return handle
    })
  })

  it('opens a single daemon sub for two callers on the same entity with different priorities', () => {
    const id = hmId('alice', {path: ['doc']})
    addSubscribedEntity({id, recursive: true, priority: 'high'})
    addSubscribedEntity({id, recursive: true, priority: 'normal'})

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledWith({id, recursive: true}, expect.anything())
    expect(discoveryStateSubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('merges options up: a recursive caller arriving later upgrades the daemon sub', () => {
    const id = hmId('alice', {path: ['doc']})
    addSubscribedEntity({id, recursive: false})
    expect(subscribeMock).toHaveBeenLastCalledWith({id, recursive: false}, expect.anything())

    addSubscribedEntity({id, recursive: true})
    expect(subscribeMock).toHaveBeenCalledTimes(2)
    expect(subscribeMock).toHaveBeenLastCalledWith({id, recursive: true}, expect.anything())
    // Old non-recursive sub torn down when re-issued.
    expect(daemonHandles[0]!.unsubscribe).toHaveBeenCalledTimes(1)
    expect(daemonHandles[1]!.unsubscribe).not.toHaveBeenCalled()
  })

  it('does not churn the daemon sub on rapid unmount/remount of a single caller', async () => {
    const id = hmId('alice', {path: ['doc']})
    const oldSub = {id}
    const newSub = {id}

    addSubscribedEntity(oldSub)
    removeSubscribedEntity(oldSub)
    addSubscribedEntity(newSub)
    // Flush the queueMicrotask that defers the removal sync.
    await Promise.resolve()
    await Promise.resolve()

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(daemonHandles[0]!.unsubscribe).not.toHaveBeenCalled()
  })

  it('keeps the shared discovery-state sub alive until the last caller leaves', async () => {
    const id = hmId('alice', {path: ['doc']})
    const subA = {id, priority: 'high' as const}
    const subB = {id, priority: 'normal' as const}

    addSubscribedEntity(subA)
    addSubscribedEntity(subB)
    expect(discoveryStateSubscribeMock).toHaveBeenCalledTimes(1)

    removeSubscribedEntity(subA)
    await Promise.resolve()
    await Promise.resolve()
    // B is still active, the shared discovery sub must NOT have been torn down.
    expect(discoveryHandles[0]!.unsubscribe).not.toHaveBeenCalled()

    removeSubscribedEntity(subB)
    await Promise.resolve()
    await Promise.resolve()
    expect(discoveryHandles[0]!.unsubscribe).toHaveBeenCalledTimes(1)
    expect(daemonHandles[0]!.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('downgrades the merged options when the recursive caller leaves', async () => {
    const id = hmId('alice', {path: ['doc']})
    const recSub = {id, recursive: true}
    const nonRecSub = {id, recursive: false}

    addSubscribedEntity(nonRecSub)
    addSubscribedEntity(recSub)
    expect(subscribeMock).toHaveBeenCalledTimes(2)
    // After the recursive caller arrives, current sub is recursive: true.

    removeSubscribedEntity(recSub)
    await Promise.resolve()
    await Promise.resolve()

    // Should have re-issued back to recursive: false now that only non-rec caller remains.
    expect(subscribeMock).toHaveBeenCalledTimes(3)
    expect(subscribeMock).toHaveBeenLastCalledWith({id, recursive: false}, expect.anything())
  })

  it('tracks separate entity ids independently', () => {
    const aliceDoc = hmId('alice', {path: ['doc']})
    const bobDoc = hmId('bob', {path: ['doc']})
    addSubscribedEntity({id: aliceDoc})
    addSubscribedEntity({id: bobDoc})

    expect(subscribeMock).toHaveBeenCalledTimes(2)
    expect(discoveryStateSubscribeMock).toHaveBeenCalledTimes(2)
  })
})

describe('window blur pause', () => {
  beforeEach(() => {
    cleanupAllEntitySubscriptions()
    subscribeMock.mockReset()
    discoveryStateSubscribeMock.mockReset()
    subscribeMock.mockImplementation(() => ({unsubscribe: vi.fn()}))
    discoveryStateSubscribeMock.mockImplementation(() => ({unsubscribe: vi.fn()}))
  })

  it('tears down daemon subs after the grace period and re-issues on focus', () => {
    vi.useFakeTimers()
    try {
      const id = hmId('alice', {path: ['doc']})
      addSubscribedEntity({id})
      expect(subscribeMock).toHaveBeenCalledTimes(1)
      const initialDaemonHandle = subscribeMock.mock.results[0]!.value as {unsubscribe: ReturnType<typeof vi.fn>}

      // Simulate window blur. Grace timer should be scheduled but not yet fired.
      focusHandlers.forEach((h) => h(false))
      vi.advanceTimersByTime(29_000)
      expect(initialDaemonHandle.unsubscribe).not.toHaveBeenCalled()

      // Past the grace window the daemon sub should be torn down.
      vi.advanceTimersByTime(2_000)
      expect(initialDaemonHandle.unsubscribe).toHaveBeenCalledTimes(1)

      // Regaining focus re-issues the daemon sub.
      focusHandlers.forEach((h) => h(true))
      expect(subscribeMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the grace timer when focus returns before it fires', () => {
    vi.useFakeTimers()
    try {
      const id = hmId('alice', {path: ['doc']})
      addSubscribedEntity({id})
      const handle = subscribeMock.mock.results[0]!.value as {unsubscribe: ReturnType<typeof vi.fn>}

      focusHandlers.forEach((h) => h(false))
      vi.advanceTimersByTime(10_000)
      focusHandlers.forEach((h) => h(true))
      // Advance past where the timer would have fired without the cancel.
      vi.advanceTimersByTime(60_000)

      expect(handle.unsubscribe).not.toHaveBeenCalled()
      // No unnecessary re-issue either, since we never actually paused.
      expect(subscribeMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
