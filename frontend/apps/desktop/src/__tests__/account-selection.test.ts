import {describe, expect, it} from 'vitest'
import {
  getSelectedIdentityFromWindowState,
  type WindowNavState,
} from '../utils/account-selection'

describe('getSelectedIdentityFromWindowState', () => {
  it('returns null when windowId is null', () => {
    const windowNavState: Record<string, WindowNavState> = {
      'window-1': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: 'account-1',
      },
    }

    const result = getSelectedIdentityFromWindowState(windowNavState, null)
    expect(result).toBe(null)
  })

  it('returns null when windowId is undefined', () => {
    const windowNavState: Record<string, WindowNavState> = {
      'window-1': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: 'account-1',
      },
    }

    const result = getSelectedIdentityFromWindowState(windowNavState, undefined)
    expect(result).toBe(null)
  })

  it('returns null when window state does not exist for given windowId', () => {
    const windowNavState: Record<string, WindowNavState> = {
      'window-1': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: 'account-1',
      },
    }

    const result = getSelectedIdentityFromWindowState(
      windowNavState,
      'window-2',
    )
    expect(result).toBe(null)
  })

  it('returns null when selectedIdentity is null in window state', () => {
    const windowNavState: Record<string, WindowNavState> = {
      'window-1': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: null,
      },
    }

    const result = getSelectedIdentityFromWindowState(
      windowNavState,
      'window-1',
    )
    expect(result).toBe(null)
  })

  it('returns selectedIdentity when it exists in window state', () => {
    const windowNavState: Record<string, WindowNavState> = {
      'window-1': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: 'account-1',
      },
    }

    const result = getSelectedIdentityFromWindowState(
      windowNavState,
      'window-1',
    )
    expect(result).toBe('account-1')
  })

  it('returns correct selectedIdentity when multiple windows exist', () => {
    const windowNavState: Record<string, WindowNavState> = {
      'window-1': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: 'account-1',
      },
      'window-2': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: 'account-2',
      },
      'window-3': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        selectedIdentity: null,
      },
    }

    expect(getSelectedIdentityFromWindowState(windowNavState, 'window-1')).toBe(
      'account-1',
    )
    expect(getSelectedIdentityFromWindowState(windowNavState, 'window-2')).toBe(
      'account-2',
    )
    expect(getSelectedIdentityFromWindowState(windowNavState, 'window-3')).toBe(
      null,
    )
  })

  it('returns null when windowNavState is empty', () => {
    const windowNavState: Record<string, WindowNavState> = {}

    const result = getSelectedIdentityFromWindowState(
      windowNavState,
      'window-1',
    )
    expect(result).toBe(null)
  })

  it('handles window state without selectedIdentity property', () => {
    const windowNavState: Record<string, WindowNavState> = {
      'window-1': {
        routes: [],
        routeIndex: 0,
        sidebarLocked: true,
        sidebarWidth: 15,
        accessoryWidth: 20,
        // selectedIdentity intentionally omitted
      } as any,
    }

    const result = getSelectedIdentityFromWindowState(
      windowNavState,
      'window-1',
    )
    expect(result).toBe(null)
  })
})
