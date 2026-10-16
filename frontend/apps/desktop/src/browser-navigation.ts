import type {NavRoute} from '@shm/shared/routes'
import {navStateReducer, type NavState} from '@shm/shared/utils/navigation'

/** A committed entry in the embedded Chromium navigation history. */
export type BrowserLocation = {
  url: string
  title: string
  browserId: number
  historyIndex: number
}

/** Reconciles Chromium history with Seed history, preserving forward entries on restores and redirects. */
export function reconcileBrowserNavigation(state: NavState, location: BrowserLocation, requested: boolean): NavState {
  const current = state.routes[state.routeIndex]
  if (current?.key !== 'web') return state
  const {url, title, browserId, historyIndex} = location
  const route: NavRoute = {key: 'web', url, title, browserId, historyIndex}
  const existingIndex = state.routes.findIndex(
    (entry) =>
      entry.key === 'web' &&
      entry.browserId === location.browserId &&
      entry.historyIndex === location.historyIndex &&
      entry.url === location.url,
  )
  if (requested || (current.browserId === location.browserId && current.historyIndex === location.historyIndex)) {
    const routes = [...state.routes]
    routes[state.routeIndex] = route
    return {...state, routes}
  }
  if (existingIndex !== -1) {
    const routes = [...state.routes]
    routes[existingIndex] = route
    return {...state, routes, routeIndex: existingIndex}
  }
  return navStateReducer(state, {type: 'push', route})
}
