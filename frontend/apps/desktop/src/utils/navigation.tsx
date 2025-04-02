import {grpcClient} from '@/grpc-client'
import {GRPCClient} from '@shm/shared/grpc-client'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {defaultRoute, NavRoute} from '@shm/shared/routes'
import {StateStream} from '@shm/shared/utils/stream'
import {useStream, useStreamSelector} from '@shm/ui/use-stream'
import {Buffer} from 'buffer'
import {createContext, useContext} from 'react'

global.Buffer = global.Buffer || Buffer

export type PushAction = {type: 'push'; route: NavRoute}
export type ReplaceAction = {type: 'replace'; route: NavRoute}
export type BackplaceAction = {type: 'backplace'; route: NavRoute}
export type CloseBackAction = {type: 'closeBack'}
export type PopAction = {type: 'pop'}
export type ForwardAction = {type: 'forward'}
export type SetSidebarLockedAction = {type: 'sidebarLocked'; value: boolean}
export type NavAction =
  | PushAction
  | ReplaceAction
  | BackplaceAction
  | CloseBackAction
  | PopAction
  | ForwardAction
  | SetSidebarLockedAction

export type NavState = {
  sidebarLocked?: boolean
  routes: NavRoute[]
  routeIndex: number
  lastAction: NavAction['type']
}
export type NavigationContext = {
  state: StateStream<NavState>
  dispatch: (action: NavAction) => void
}

export function getRouteKey(route: NavRoute): string {
  if (route.key === 'draft')
    return `draft:${route.id?.uid}:${route.id?.path?.join(':')}`
  if (route.key === 'document')
    return `document:${route.id.uid}:${route.id.path?.join(':')}` // version changes and publication page remains mounted
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
    default:
      return state
  }
}

export function simpleStringy(obj: any): string {
  if (Array.isArray(obj)) {
    return obj.map(simpleStringy).join(', ')
  }
  if (obj === null) return 'null'
  if (typeof obj === 'string') return obj
  if (typeof obj === 'number') return String(obj)
  if (typeof obj === 'boolean') return String(obj)
  if (typeof obj === 'object') {
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${simpleStringy(v)}`)
      .join(', ')
  }
  return '?'
}

let appNavDispatch: null | React.Dispatch<NavAction> = null

export function setAppNavDispatch(v: null | React.Dispatch<NavAction>) {
  appNavDispatch = v
}

export function dispatchAppNavigation(action: NavAction) {
  if (!appNavDispatch) {
    throw new Error('App Navigation not ready or available')
  }
  return appNavDispatch(action)
}

export function useNavigation() {
  const nav = useContext(NavContext)
  if (!nav)
    throw new Error('useNavigation must be used within a NavigationProvider')
  return nav
}

export const NavContextProvider = NavContext.Provider

export function useNavRoute() {
  const nav = useContext(NavContext)
  if (!nav)
    throw new Error('useNavRoute must be used within a NavigationProvider')
  const navRoute = useStreamSelector<NavState, NavRoute>(
    nav.state,
    (state, prevSelected) => {
      return state.routes[state.routeIndex] || defaultRoute
    },
  )
  return navRoute
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

export type NavMode = 'push' | 'replace' | 'spawn' | 'backplace'

export function appRouteOfId(id: UnpackedHypermediaId): NavRoute | undefined {
  let navRoute: NavRoute | undefined = undefined
  if (id?.type === 'd') {
    navRoute = {
      key: 'document',
      id,
    }
  } else if (id?.type === 'comment') {
    navRoute = {
      key: 'comment',
      commentId: id,
    }
  }
  return navRoute
}

export function isHttpUrl(url: string) {
  return /^https?:\/\//.test(url)
}

export function useHmIdToAppRouteResolver() {
  return (
    id: UnpackedHypermediaId,
  ): Promise<null | (UnpackedHypermediaId & {navRoute?: NavRoute})> => {
    return resolveHmIdToAppRoute(id, grpcClient).catch((e) => {
      console.error(e)
      // toast.error('Failed to resolve ID to app route')
      return null
    })
  }
}

export async function resolveHmIdToAppRoute(
  hmId: UnpackedHypermediaId,
  grpcClient: GRPCClient,
): Promise<null | (UnpackedHypermediaId & {navRoute?: NavRoute})> {
  if (hmId?.type === 'd') {
    return {
      ...hmId,
      navRoute: {
        key: 'document',
        id: {...hmId, version: null},
      },
    }
  }
  if (!hmId) return null
  const navRoute = appRouteOfId(hmId)
  if (!navRoute) return null
  return {...hmId, navRoute}
}
