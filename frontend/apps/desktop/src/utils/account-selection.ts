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
