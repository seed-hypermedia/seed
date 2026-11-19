import {navRouteSchema, type NavRoute} from '@shm/shared/routes'
import {getRouteWindowResourceKeys, type WindowDraftLookup} from './route-window-identity'

type SavedWindow = {routes: NavRoute[]; routeIndex: number; lastFocusedAt?: number}

/** Selects deterministic survivors without modifying saved histories or any document/draft data. */
export function reconcileSavedWindows<T extends SavedWindow>(saved: Record<string, T>, getDraft: WindowDraftLookup) {
  const removed: string[] = []
  const valid: Record<string, T> = {}
  for (const [id, window] of Object.entries(saved)) {
    if (!window || !Array.isArray(window.routes)) {
      removed.push(id)
      continue
    }
    const isValid = (route: unknown) => navRouteSchema.safeParse(route).success
    const routes = window.routes.filter(isValid)
    if (!routes.length) {
      removed.push(id)
      continue
    }
    const keptUpToCurrent = window.routes.slice(0, window.routeIndex + 1).filter(isValid).length
    valid[id] = {...window, routes, routeIndex: Math.max(0, keptUpToCurrent - 1)}
  }
  const entries = Object.entries(valid).sort(
    ([a, left], [b, right]) => (right.lastFocusedAt ?? 0) - (left.lastFocusedAt ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  )
  const windows: Record<string, T> = {}
  // An edit draft can connect a published route and a placeholder that appeared earlier.
  // Resolve connected groups first; a greedy first-match pass would keep both earlier windows.
  const parent = entries.map((_, index) => index)
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)))
  const aliases = new Map<string, number>()
  entries.forEach(([, window], index) => {
    const route = window.routes[window.routeIndex]
    for (const key of route ? getRouteWindowResourceKeys(route, getDraft) : []) {
      const previous = aliases.get(key)
      if (previous !== undefined) {
        const a = root(previous)
        const b = root(index)
        parent[Math.max(a, b)] = Math.min(a, b)
      }
      aliases.set(key, index)
    }
  })
  entries.forEach(([id, window], index) => {
    if (root(index) === index) windows[id] = window
    else removed.push(id)
  })
  return {windows, removed}
}
