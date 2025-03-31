import {client} from '@/trpc'
import {DAEMON_FILE_URL} from '@shm/shared'
import {defaultRoute, NavRoute} from '@shm/shared/routes'
import {UniversalAppProvider} from '@shm/shared/routing'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
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

let navStateStore:
  | {
      dispatch: (action: NavAction) => void
      state: StateStream<NavState>
    }
  | undefined = undefined

export let globalNavState: StateStream<NavState> | undefined = undefined

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
  console.log('~~ NavigationContainer render ', initialNav)
  const {externalOpen} = useAppContext()
  const navigation = useMemo(() => {
    console.log('~~ NavigationContainer useMemo')
    const [updateNavState, navState] = writeableStateStream(initialNav)
    globalNavState = navState
    if (navStateStore) {
      return navStateStore
      // throw new Error('~~ NavigationContainer already here')
    }
    navStateStore = {
      dispatch(action: NavAction) {
        const prevState = navState.get()
        const newState = navStateReducer(prevState, action)
        if (prevState !== newState) {
          console.log('~~ NavigationContainer dispatch', action, newState)
          updateNavState(newState)
        } else if (action.type === 'closeBack') {
          client.closeAppWindow.mutate(window.windowId)
        }
      },
      state: navState,
    }
    return navStateStore
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
