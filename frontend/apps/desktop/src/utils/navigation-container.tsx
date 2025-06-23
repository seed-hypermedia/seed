import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {dialogBoxShadow} from '@/components/dialog'
import {ipc} from '@/ipc'
import {useExperiments} from '@/models/experiments'
import {useGatewayUrl} from '@/models/gateway-settings'
import {client} from '@/trpc'
import {
  DAEMON_FILE_URL,
  DEFAULT_GATEWAY_URL,
  UnpackedHypermediaId,
} from '@shm/shared'
import {defaultRoute, NavRoute} from '@shm/shared/routes'
import {UniversalAppProvider} from '@shm/shared/routing'
import {streamSelector, writeableStateStream} from '@shm/shared/utils/stream'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ReactQueryDevtools} from '@tanstack/react-query-devtools'
import {ReactNode, useEffect, useMemo} from 'react'
import {Button, View, XStack} from 'tamagui'
import {useAppContext, useIPC} from '../app-context'
import {
  NavAction,
  NavContextProvider,
  NavState,
  navStateReducer,
  setAppNavDispatch,
  useNavRoute,
} from './navigation'
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
        ipc.invoke('plugin:window|open', {path})
      }}
      openUrl={(url: string) => {
        externalOpen(url)
      }}
      onCopyReference={async (hmId: UnpackedHypermediaId) => {
        onCopyReference(hmId)
      }}
      hmUrlHref={true}
      selectedIdentity={navigation.selectedIdentity}
      setSelectedIdentity={(keyId: string | null) => {
        navigation.dispatch({type: 'selectedIdentity', value: keyId})
      }}
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
      <View userSelect="none">
        <ReactQueryDevtools />
      </View>
      <XStack
        position="absolute"
        bottom={20}
        left={60}
        zIndex={1000}
        backgroundColor="$color1"
        boxShadow={dialogBoxShadow}
      >
        <Button onPress={() => routeDialog.open(route)}>View Route</Button>
      </XStack>
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
