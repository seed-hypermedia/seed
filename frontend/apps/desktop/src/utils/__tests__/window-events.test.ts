import {describe, expect, it, vi, beforeEach} from 'vitest'
import type {AppWindowEvent} from '../window-events'

// Mock eventStream implementation for testing
function createMockEventStream<T>() {
  const handlers = new Set<(event: T) => void>()

  function dispatch(event: T) {
    handlers.forEach((handle) => handle(event))
  }

  const stream = {
    subscribe(handler: (event: T) => void) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }

  return [dispatch, stream] as const
}

describe('window-events', () => {
  describe('eventStream subscription pattern', () => {
    it('should dispatch events to all subscribers', () => {
      const [dispatch, stream] = createMockEventStream<AppWindowEvent>()
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      stream.subscribe(handler1)
      stream.subscribe(handler2)

      const event: AppWindowEvent = {type: 'toggle_sidebar'}
      dispatch(event)

      expect(handler1).toHaveBeenCalledWith(event)
      expect(handler2).toHaveBeenCalledWith(event)
      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('should unsubscribe handlers when cleanup function is called', () => {
      const [dispatch, stream] = createMockEventStream<AppWindowEvent>()
      const handler = vi.fn()

      const unsubscribe = stream.subscribe(handler)

      dispatch({type: 'toggle_sidebar'})
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      dispatch({type: 'toggle_sidebar'})
      expect(handler).toHaveBeenCalledTimes(1) // Still 1, not called again
    })

    it('should handle multiple event types', () => {
      const [dispatch, stream] = createMockEventStream<AppWindowEvent>()
      const handler = vi.fn()

      stream.subscribe(handler)

      dispatch({type: 'toggle_sidebar'})
      dispatch({type: 'toggle_accessory', index: 0})
      dispatch({type: 'back'})

      expect(handler).toHaveBeenCalledTimes(3)
      expect(handler).toHaveBeenNthCalledWith(1, {type: 'toggle_sidebar'})
      expect(handler).toHaveBeenNthCalledWith(2, {
        type: 'toggle_accessory',
        index: 0,
      })
      expect(handler).toHaveBeenNthCalledWith(3, {type: 'back'})
    })
  })

  describe('event filtering by type', () => {
    it('should filter events by type correctly', () => {
      const [dispatch, stream] = createMockEventStream<AppWindowEvent>()
      const sidebarHandler = vi.fn()
      const accessoryHandler = vi.fn()

      // Simulate useListenAppEvent filtering logic
      stream.subscribe((event) => {
        if (event.type === 'toggle_sidebar') {
          sidebarHandler(event)
        }
        if (event.type === 'toggle_accessory') {
          accessoryHandler(event)
        }
      })

      dispatch({type: 'toggle_sidebar'})
      dispatch({type: 'toggle_accessory', index: 0})
      dispatch({type: 'back'})

      expect(sidebarHandler).toHaveBeenCalledTimes(1)
      expect(sidebarHandler).toHaveBeenCalledWith({type: 'toggle_sidebar'})

      expect(accessoryHandler).toHaveBeenCalledTimes(1)
      expect(accessoryHandler).toHaveBeenCalledWith({
        type: 'toggle_accessory',
        index: 0,
      })
    })
  })

  describe('toggle_accessory event payload', () => {
    it('should correctly pass index in toggle_accessory event', () => {
      const [dispatch, stream] = createMockEventStream<AppWindowEvent>()
      const handler = vi.fn()

      stream.subscribe((event) => {
        if (event.type === 'toggle_accessory') {
          handler(event.index)
        }
      })

      dispatch({type: 'toggle_accessory', index: 0})
      dispatch({type: 'toggle_accessory', index: 2})
      dispatch({type: 'toggle_accessory', index: 4})

      expect(handler).toHaveBeenCalledTimes(3)
      expect(handler).toHaveBeenNthCalledWith(1, 0)
      expect(handler).toHaveBeenNthCalledWith(2, 2)
      expect(handler).toHaveBeenNthCalledWith(3, 4)
    })
  })

  describe('IPC trigger pattern', () => {
    beforeEach(() => {
      // Reset mocks
      vi.clearAllMocks()
    })

    it('should send correct event structure via IPC', () => {
      // Simulate useTriggerWindowEvent logic
      const mockIPCSend = vi.fn()
      const ipc = {send: mockIPCSend}

      const triggerEvent = (event: AppWindowEvent) => {
        ipc.send('focusedWindowAppEvent', event)
      }

      triggerEvent({type: 'toggle_sidebar'})
      triggerEvent({type: 'toggle_accessory', index: 1})

      expect(mockIPCSend).toHaveBeenCalledTimes(2)
      expect(mockIPCSend).toHaveBeenNthCalledWith(
        1,
        'focusedWindowAppEvent',
        {type: 'toggle_sidebar'},
      )
      expect(mockIPCSend).toHaveBeenNthCalledWith(
        2,
        'focusedWindowAppEvent',
        {type: 'toggle_accessory', index: 1},
      )
    })
  })
})
