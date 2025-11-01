import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {desktopUniversalClient} from '@/desktop-universal-client'
import {ipc} from '@/ipc'
import {useExperiments} from '@/models/experiments'
import {useGatewayUrl} from '@/models/gateway-settings'
import {client} from '@/trpc'
import {UnpackedHypermediaId} from '@shm/shared'
import {DAEMON_FILE_URL, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {defaultRoute, NavRoute} from '@shm/shared/routes'
import {UniversalAppProvider} from '@shm/shared/routing'
import {
  NavAction,
  NavContextProvider,
  NavState,
  navStateReducer,
  setAppNavDispatch,
  useNavRoute,
} from '@shm/shared/utils/navigation'
import {streamSelector, writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {dialogBoxShadow, useAppDialog} from '@shm/ui/universal-dialog'
import {ReactQueryDevtools} from '@tanstack/react-query-devtools'
import {ReactNode, useEffect, useMemo} from 'react'
import {useAppContext, useIPC} from '../app-context'
import {encodeRouteToPath} from './route-encoding'
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
          // @ts-expect-error
          client.closeAppWindow.mutate(window.windowId)
        }
      },
      state: navState,
      selectedIdentity: streamSelector<NavState, string | null>(
        navState,
        (state) => state.selectedIdentity || null,
      ),
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
    return window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
      if (event.type === 'back') {
        navigation.dispatch({type: 'pop'})
      }
      if (event.type === 'forward') {
        navigation.dispatch({type: 'forward'})
      }
      if (event.type === 'selectedIdentityChanged') {
        // Update the navigation state with the new selected identity
        navigation.dispatch({
          type: 'selectedIdentity',
          value: event.selectedIdentity,
        })
        console.log('Selected identity changed externally:', {
          newSelectedIdentity: event.selectedIdentity,
        })
      }
    })
  }, [navigation])

  useEffect(() => {
    setAppNavDispatch(navigation.dispatch)
    return () => {
      setAppNavDispatch(null)
    }
  }, [])

  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const [copyRefContent, onCopyReference] = useCopyReferenceUrl(
    gwUrl,
    undefined,
    navigation,
  )

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
      openRouteNewWindow={(route: NavRoute) => {
        const path = encodeRouteToPath(route)
        const selectedIdentity = navigation.selectedIdentity.get()
        ipc.invoke('plugin:window|open', {path, selectedIdentity})
      }}
      openUrl={(url: string) => {
        externalOpen(url)
      }}
      origin={gwUrl}
      onCopyReference={async (hmId: UnpackedHypermediaId) => {
        onCopyReference(hmId)
      }}
      hmUrlHref={true}
      selectedIdentity={navigation.selectedIdentity}
      setSelectedIdentity={(keyId: string | null) => {
        navigation.dispatch({type: 'selectedIdentity', value: keyId})
      }}
      universalClient={desktopUniversalClient}
    >
      <NavContextProvider value={navigation}>
        {children}
        {copyRefContent}
        <DevTools />
      </NavContextProvider>
    </UniversalAppProvider>
  )
}

function DevTools() {
  const {data: experiments} = useExperiments()
  const route = useNavRoute()
  const routeDialog = useAppDialog(RouteDialog)
  return experiments?.developerTools ? (
    <>
      <div className="select-none">
        <ReactQueryDevtools />
      </div>
      <div
        className="absolute bottom-5 left-15 z-40 bg-white dark:bg-black"
        style={{
          boxShadow: dialogBoxShadow,
        }}
      >
        <Button variant="outline" onClick={() => routeDialog.open(route)}>
          View Route
        </Button>
      </div>
      {routeDialog.content}
    </>
  ) : null
}

function RouteDialog({input}: {input: NavRoute}) {
  return (
    <code style={{whiteSpace: 'pre-wrap'}}>
      {JSON.stringify(input, null, 2)}
    </code>
  )
}
