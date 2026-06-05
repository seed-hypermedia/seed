import {describe, expect, it} from 'vitest'
import {
  getSelectedIdentityFromWindowState,
  mergeWindowNavState,
  resolveSelectedIdentityForWindow,
  type WindowNavState,
} from '../utils/account-selection'

describe('resolveSelectedIdentityForWindow', () => {
  it('uses a valid input selection before persisted or focused fallbacks', () => {
    expect(
      resolveSelectedIdentityForWindow({
        availableAccountIds: ['account-1', 'account-2', 'account-3'],
        inputSelectedIdentity: 'account-1',
        persistedSelectedIdentity: 'account-2',
        focusedSelectedIdentity: 'account-3',
      }),
    ).toBe('account-1')
  })

  it('falls back to persisted selection when provided input is invalid', () => {
    expect(
      resolveSelectedIdentityForWindow({
        availableAccountIds: ['account-2', 'account-3'],
        inputSelectedIdentity: 'deleted-account',
        persistedSelectedIdentity: 'account-2',
        focusedSelectedIdentity: 'account-3',
      }),
    ).toBe('account-2')
  })

  it('inherits focused selection when no explicit input is provided', () => {
    expect(
      resolveSelectedIdentityForWindow({
        availableAccountIds: ['account-1', 'account-2'],
        focusedSelectedIdentity: 'account-1',
        persistedSelectedIdentity: 'account-2',
      }),
    ).toBe('account-1')
  })

  it('uses persisted selection when focused fallback is invalid', () => {
    expect(
      resolveSelectedIdentityForWindow({
        availableAccountIds: ['account-2'],
        focusedSelectedIdentity: 'deleted-account',
        persistedSelectedIdentity: 'account-2',
      }),
    ).toBe('account-2')
  })

  it('uses the first available account instead of returning null when accounts exist', () => {
    expect(
      resolveSelectedIdentityForWindow({
        availableAccountIds: ['account-1'],
        inputSelectedIdentity: 'deleted-account',
        persistedSelectedIdentity: 'also-deleted',
        focusedSelectedIdentity: null,
      }),
    ).toBe('account-1')
  })

  it('returns null only when no accounts are available', () => {
    expect(
      resolveSelectedIdentityForWindow({
        availableAccountIds: [],
        inputSelectedIdentity: 'deleted-account',
        persistedSelectedIdentity: null,
        focusedSelectedIdentity: null,
      }),
    ).toBe(null)
  })
})

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

    const result = getSelectedIdentityFromWindowState(windowNavState, 'window-2')
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

    const result = getSelectedIdentityFromWindowState(windowNavState, 'window-1')
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

    const result = getSelectedIdentityFromWindowState(windowNavState, 'window-1')
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

    expect(getSelectedIdentityFromWindowState(windowNavState, 'window-1')).toBe('account-1')
    expect(getSelectedIdentityFromWindowState(windowNavState, 'window-2')).toBe('account-2')
    expect(getSelectedIdentityFromWindowState(windowNavState, 'window-3')).toBe(null)
  })

  it('returns null when windowNavState is empty', () => {
    const windowNavState: Record<string, WindowNavState> = {}

    const result = getSelectedIdentityFromWindowState(windowNavState, 'window-1')
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

    const result = getSelectedIdentityFromWindowState(windowNavState, 'window-1')
    expect(result).toBe(null)
  })
})

describe('mergeWindowNavState', () => {
  it('preserves assistant state when navigation updates omit assistant fields', () => {
    const currentState: WindowNavState = {
      routes: [{key: 'document'}],
      routeIndex: 0,
      sidebarLocked: true,
      sidebarWidth: 15,
      accessoryWidth: 20,
      selectedIdentity: 'account-1',
      assistantOpen: true,
      assistantSessionId: 'session-1',
    }

    const result = mergeWindowNavState(currentState, {
      routes: [{key: 'library'}],
      routeIndex: 0,
      sidebarLocked: false,
      sidebarWidth: 18,
      accessoryWidth: 24,
      selectedIdentity: 'account-2',
    })

    expect(result).toMatchObject({
      routes: [{key: 'library'}],
      routeIndex: 0,
      sidebarLocked: false,
      sidebarWidth: 18,
      accessoryWidth: 24,
      selectedIdentity: 'account-2',
      assistantOpen: true,
      assistantSessionId: 'session-1',
    })
  })

  it('updates assistant state when assistant fields are provided', () => {
    const currentState: WindowNavState = {
      routes: [{key: 'document'}],
      routeIndex: 0,
      sidebarLocked: true,
      sidebarWidth: 15,
      accessoryWidth: 20,
      selectedIdentity: 'account-1',
      assistantOpen: false,
      assistantSessionId: null,
    }

    const result = mergeWindowNavState(currentState, {
      assistantOpen: true,
      assistantSessionId: 'session-2',
    })

    expect(result.assistantOpen).toBe(true)
    expect(result.assistantSessionId).toBe('session-2')
    expect(result.routes).toEqual(currentState.routes)
  })
})
