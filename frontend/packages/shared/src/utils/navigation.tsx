import {Buffer} from 'buffer'
import {createContext, useCallback, useContext} from 'react'
import {UnpackedHypermediaId} from '../hm-types'
import {defaultRoute, NavRoute} from '../routes'
import {UniversalAppContext} from '../routing'
import {useStream, useStreamSelector} from '../use-stream'
import {hmId} from './entity-id-url'
import {StateStream} from './stream'

if (typeof global !== 'undefined') {
  global.Buffer = global.Buffer || Buffer
}

export type PushAction = {type: 'push'; route: NavRoute}
export type ReplaceAction = {type: 'replace'; route: NavRoute}
export type BackplaceAction = {type: 'backplace'; route: NavRoute}
export type CloseBackAction = {type: 'closeBack'}
export type PopAction = {type: 'pop'}
export type ForwardAction = {type: 'forward'}
export type SetSidebarLockedAction = {type: 'sidebarLocked'; value: boolean}
export type SetSidebarWidthAction = {type: 'sidebarWidth'; value: number}
export type SetSelectionWidthAction = {type: 'accessoryWidth'; value: number}
export type SetSelectedIdentityAction = {
  type: 'selectedIdentity'
  value: string | null
}

export type NavAction =
  | PushAction
  | ReplaceAction
  | BackplaceAction
  | CloseBackAction
  | PopAction
  | ForwardAction
  | SetSidebarLockedAction
  | SetSidebarWidthAction
  | SetSelectionWidthAction
  | SetSelectedIdentityAction
export type NavState = {
  sidebarLocked?: boolean
  sidebarWidth?: number
  accessoryWidth?: number
  routes: NavRoute[]
  routeIndex: number
  lastAction: NavAction['type']
  selectedIdentity?: string | null
}
export type NavigationContext = {
  state: StateStream<NavState>
  dispatch: (action: NavAction) => void
}

export function getRouteKey(route: NavRoute): string {
  if (route.key === 'draft') {
    return `draft:${route.id}`
  }
  if (
    route.key === 'document' ||
    route.key === 'discussions' ||
    route.key === 'activity' ||
    route.key === 'collaborators' ||
    route.key === 'directory'
  )
    return `document:${route.id.uid}:${route.id.path?.join(':')}` // version changes and publication page remains mounted
  if (route.key === 'feed')
    return `feed:${route.id.uid}:${route.id.path?.join(':')}` // version changes and publication page remains mounted
  return route.key
}

const NavContext = createContext<null | NavigationContext>(null)

export function navStateReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'push':
      return {
        ...state,
        routes: [...state.routes.slice(0, state.routeIndex + 1), action.route],
        routeIndex: state.routeIndex + 1,
        lastAction: action.type,
      }
    case 'replace':
      return {
        ...state,
        routes: [...state.routes.slice(0, state.routeIndex), action.route],
        routeIndex: state.routeIndex,
        lastAction: action.type,
      }

    case 'backplace': {
      if (state.routeIndex === 0) {
        return {
          ...state,
          routes: [action.route],
          routeIndex: 0,
          lastAction: action.type,
        }
      }
      return {
        ...state,
        routes: [
          ...state.routes.slice(0, state.routes.length - 1),
          action.route,
        ],
        routeIndex: state.routeIndex,
        lastAction: action.type,
      }
    }
    case 'closeBack':
    case 'pop': {
      if (state.routeIndex === 0) return state
      return {
        ...state,
        routeIndex: state.routeIndex - 1,
        lastAction: action.type,
      }
    }
    case 'forward':
      return {
        ...state,
        routes: state.routes,
        routeIndex: Math.min(state.routeIndex + 1, state.routes.length - 1),
        lastAction: action.type,
      }
    case 'sidebarLocked':
      return {
        ...state,
        sidebarLocked: action.value,
      }
    case 'sidebarWidth':
      return {
        ...state,
        sidebarWidth: action.value,
      }
    case 'accessoryWidth':
      return {
        ...state,
        accessoryWidth: action.value,
      }
    case 'selectedIdentity':
      return {
        ...state,
        selectedIdentity: action.value,
      }
    default:
      return state
  }
}

export function useNavigation(overrideNav: NavigationContext | undefined) {
  const nav = useContext(NavContext)
  if (overrideNav) {
    return overrideNav
  }
  if (!nav)
    throw new Error('useNavigation must be used within a NavigationProvider')
  return nav
}

export const NavContextProvider = NavContext.Provider

export function useNavRoute() {
  const nav = useContext(NavContext)
  if (!nav)
    throw new Error('useNavRoute must be used within a NavigationProvider')
  const navRoute = useStreamSelector<NavState, NavRoute>(nav.state, (state) => {
    return state.routes[state.routeIndex] || defaultRoute
  })
  return navRoute
}

export function useRouteDocId(): UnpackedHypermediaId | null {
  const route = useNavRoute()
  if (route.key === 'document') {
    return route.id
  }
  if (route.key === 'draft') {
    if (route.editUid) {
      return hmId(route.editUid, {
        path: route.editPath,
      })
    }
  }
  return null
}

export function useNavigationState() {
  const nav = useContext(NavContext)
  if (!nav)
    throw new Error(
      'useNavigationState must be used within a NavigationProvider',
    )
  return useStream<NavState>(nav.state)
}

export function useNavigationDispatch() {
  const nav = useContext(NavContext)
  if (!nav)
    throw new Error(
      'useNavigationDispatch must be used within a NavigationProvider',
    )
  return nav.dispatch
}

/**
 * Unified navigation hook that works on both web and desktop.
 * On web, it syncs with the browser URL via openRoute from UniversalAppContext.
 * On desktop, it dispatches to navigation state.
 *
 * @param mode - 'push' adds to history, 'replace' replaces current entry
 */
export function useNavigate(mode: 'push' | 'replace' = 'push') {
  const context = useContext(UniversalAppContext)
  const dispatch = useNavigationDispatch()

  return useCallback(
    (route: NavRoute) => {
      // Use openRoute from context if available (handles URL sync on web)
      if (context?.openRoute) {
        context.openRoute(route, mode === 'replace')
      } else {
        // Fallback to direct dispatch (shouldn't happen in normal usage)
        dispatch({type: mode, route})
      }
    },
    [context, dispatch, mode],
  )
}

export type NavMode = 'push' | 'replace' | 'spawn' | 'backplace'

export function appRouteOfId(id: UnpackedHypermediaId): NavRoute | undefined {
  let navRoute: NavRoute | undefined = undefined
  navRoute = {
    key: 'document',
    id,
  }
  return navRoute
}

export function isHttpUrl(url: string) {
  return /^https?:\/\//.test(url)
}
