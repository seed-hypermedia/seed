/**
 * Pure utility functions for account selection logic.
 * These functions have no dependencies on Electron or other modules,
 * making them easy to unit test.
 */

export type WindowNavState = {
  routes: any[]
  routeIndex: number
  sidebarLocked: boolean
  sidebarWidth: number
  accessoryWidth: number
  selectedIdentity?: string | null
  assistantOpen?: boolean
  assistantSessionId?: string | null
}

/**
 * Pure function to get selected identity from window nav state.
 * Returns the selected identity for a given window ID, or null if not found.
 */
export function getSelectedIdentityFromWindowState(
  windowNavState: Record<string, WindowNavState>,
  windowId: string | null | undefined,
): string | null {
  if (!windowId) return null
  const windowState = windowNavState[windowId]
  return windowState?.selectedIdentity || null
}

/**
 * Pure function to merge a partial window nav update with the current state.
 * Preserves assistant state when navigation updates omit assistant fields.
 */
export function mergeWindowNavState(
  currentState: WindowNavState | undefined,
  nextState: Partial<WindowNavState>,
): WindowNavState {
  return {
    routes: nextState.routes ?? currentState?.routes ?? [],
    routeIndex: nextState.routeIndex ?? currentState?.routeIndex ?? 0,
    sidebarLocked: nextState.sidebarLocked ?? currentState?.sidebarLocked ?? true,
    sidebarWidth: nextState.sidebarWidth ?? currentState?.sidebarWidth ?? 15,
    accessoryWidth: nextState.accessoryWidth ?? currentState?.accessoryWidth ?? 20,
    selectedIdentity:
      nextState.selectedIdentity !== undefined ? nextState.selectedIdentity : currentState?.selectedIdentity ?? null,
    assistantOpen:
      nextState.assistantOpen !== undefined ? nextState.assistantOpen : currentState?.assistantOpen ?? false,
    assistantSessionId:
      nextState.assistantSessionId !== undefined
        ? nextState.assistantSessionId
        : currentState?.assistantSessionId ?? null,
  }
}
