import {client} from '@/trpc'
import {DAEMON_FILE_URL} from '@shm/shared'
import {defaultRoute, NavRoute} from '@shm/shared/routes'
import {UniversalAppProvider} from '@shm/shared/routing'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {ReactNode, useEffect, useMemo} from 'react'
import {useAppContext, useIPC} from '../app-context'
import {
  NavAction,
  NavContextProvider,
  NavState,
  navStateReducer,
  setAppNavDispatch,
} from './navigation'
import {AppWindowEvent} from './window-events'

export function NavigationContainer({
  children,
  initialNav = {
    sidebarLocked: false,
    routes: [defaultRoute],
    routeIndex: 0,
    lastAction: 'replace',
  },
}: {
  children: ReactNode
  initialNav?: NavState
}) {
  const {externalOpen} = useAppContext()
  const navigation = useMemo(() => {
    const [updateNavState, navState] = writeableStateStream(initialNav)
    return {
      dispatch(action: NavAction) {
        const prevState = navState.get()
        const newState = navStateReducer(prevState, action)
        if (prevState !== newState) {
          updateNavState(newState)
        } else if (action.type === 'closeBack') {
          client.closeAppWindow.mutate(window.windowId)
        }
      },
      state: navState,
    }
  }, [])
  const {send} = useIPC()

  useEffect(() => {
    return navigation.state.subscribe(() => {
      const state = navigation.state.get()
      send('windowNavState', state)
    })
  }, [navigation, send])

  useEffect(() => {
    // @ts-expect-error
    return window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
      if (event === 'back') {
        navigation.dispatch({type: 'pop'})
      }
      if (event === 'forward') {
        navigation.dispatch({type: 'forward'})
      }
    })
  }, [])

  useEffect(() => {
    setAppNavDispatch(navigation.dispatch)
    return () => {
      setAppNavDispatch(null)
    }
  }, [])

  return (
    <UniversalAppProvider
      ipfsFileUrl={DAEMON_FILE_URL}
      openRoute={(route: NavRoute, replace?: boolean) => {
        if (replace) {
          navigation.dispatch({type: 'replace', route})
        } else {
          navigation.dispatch({type: 'push', route})
        }
      }}
      openUrl={(url: string) => {
        externalOpen(url)
      }}
    >
      <NavContextProvider value={navigation}>{children}</NavContextProvider>
    </UniversalAppProvider>
  )
}
