import {NavRoute} from '@shm/shared/routes'
import {startTransition, useCallback} from 'react'
import {
  NavMode,
  openRouteInNewWindow,
  useNavigationDispatch,
} from './navigation'
import {getRouteWindowType, getWindowType} from './window-types'

export function useNavigate(requestedMode: NavMode = 'push') {
  const dispatch = useNavigationDispatch()
  return useCallback(
    (route: NavRoute) => {
      const routeWindowType = getRouteWindowType(route)
      const mode =
        routeWindowType.key === getWindowType() ? requestedMode : 'spawn'
      startTransition(() => {
        if (mode === 'spawn') {
          openRouteInNewWindow(route)
        } else if (mode === 'push') {
          dispatch({type: 'push', route})
        } else if (mode === 'replace') {
          dispatch({type: 'replace', route})
        } else if (mode === 'backplace') {
          dispatch({type: 'backplace', route})
        }
      })
    },
    [dispatch, requestedMode],
  )
}

export function useClickNavigate() {
  const navigate = useNavigate()
  const spawn = useNavigate('spawn')

  return (
    route: NavRoute,
    event: any, // GestureResponderEvent
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.metaKey || event.shiftKey) {
      spawn(route)
    } else {
      navigate(route)
    }
  }
}
