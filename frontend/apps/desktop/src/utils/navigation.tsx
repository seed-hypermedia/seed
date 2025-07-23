import {hmId} from '@shm/shared'
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
export type SetSidebarWidthAction = {type: 'sidebarWidth'; value: number}
export type SetAccessoryWidthAction = {type: 'accessoryWidth'; value: number}
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
  | SetAccessoryWidthAction
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
  if (route.key == 'draft') {
    return `draft:${route.id}`
  }
  if (route.key == 'document')
    return `document:${route.id.uid}:${route.id.path?.join(':')}` // version changes and publication page remains mounted
  return route.key
}

const NavContext = createContext<null | NavigationContext>(null)

export function navStateReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'push':
      return {
        ...state,
        routes: [
          ...state.routes.slice(0, state.routeIndex + 1),
          spreadRouteIfPossible(state.routes, action.route),
        ],
        routeIndex: state.routeIndex + 1,
        lastAction: action.type,
      }
    case 'replace':
      return {
        ...state,
        routes: [
          ...state.routes.slice(0, state.routeIndex),
          spreadRouteIfPossible(state.routes, action.route),
        ],
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

function spreadRouteIfPossible(routes: Array<NavRoute>, nextRoute: NavRoute) {
  if (nextRoute.key !== 'document' && nextRoute.key !== 'draft') {
    return nextRoute
  }

  if (routes.length === 0) {
    return nextRoute
  }

  const prevRoute = routes[routes.length - 1]

  // Debug logging for document-to-document transitions
  if (prevRoute.key === 'document' && nextRoute.key === 'document') {
    console.log('🔍 [DEBUG] Document-to-Document transition:', {
      prevAccessory: 'accessory' in prevRoute ? prevRoute.accessory : 'none',
      nextAccessory: 'accessory' in nextRoute ? nextRoute.accessory : 'none',
    })
  }

  // Step 1: Determine the accessory to use
  let resultAccessory =
    'accessory' in nextRoute ? nextRoute.accessory : undefined

  // If nextRoute has no accessory, spread from prevRoute
  if (!resultAccessory) {
    if (prevRoute.key === 'document' || prevRoute.key === 'draft') {
      const prevAccessory =
        'accessory' in prevRoute ? prevRoute.accessory : undefined
      if (prevAccessory) {
        // Special case: don't spread 'options' from draft to document
        if (
          prevRoute.key === 'draft' &&
          prevAccessory.key === 'options' &&
          nextRoute.key === 'document'
        ) {
          resultAccessory = undefined
          console.log('🔍 [DEBUG] Not spreading options from draft to document')
        } else {
          resultAccessory = prevAccessory
          console.log(
            '🔍 [DEBUG] Spreading accessory:',
            prevAccessory,
            '→',
            resultAccessory,
          )
        }
      } else if (nextRoute.key === 'draft') {
        // Special case: going to draft with no accessory defaults to 'options'
        resultAccessory = {key: 'options'}
        console.log('🔍 [DEBUG] Defaulting to options for draft')
      }
    }
  }

  // Step 2: Post-processing - if result is document with 'options', change to 'activity'
  if (nextRoute.key === 'document' && resultAccessory?.key === 'options') {
    console.log('🔍 [DEBUG] Post-processing: changing options to activity')
    resultAccessory = {key: 'activity'}
  }

  const result = {
    ...nextRoute,
    ...(resultAccessory && {accessory: resultAccessory}),
  }

  // Debug final result for document-to-document
  if (prevRoute.key === 'document' && nextRoute.key === 'document') {
    console.log('🔍 [DEBUG] Final document-to-document result:', {
      resultAccessory: resultAccessory,
    })
  }

  return result
}
