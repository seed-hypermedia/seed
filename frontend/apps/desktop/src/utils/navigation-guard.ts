import type {NavAction} from '@shm/shared/utils/navigation'

// Navigation guard: blocks route-changing actions until confirmed
export type NavigationGuard = (action: NavAction, proceed: () => void) => boolean
let navigationGuard: NavigationGuard | null = null

export function setNavigationGuard(guard: NavigationGuard) {
  navigationGuard = guard
}

export function clearNavigationGuard() {
  navigationGuard = null
}

export function getNavigationGuard(): NavigationGuard | null {
  return navigationGuard
}

export const ROUTE_CHANGING_ACTIONS = new Set(['push', 'replace', 'backplace', 'pop', 'forward', 'closeBack'])
