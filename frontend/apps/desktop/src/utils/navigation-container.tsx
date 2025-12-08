import {desktopUniversalClient} from '@/desktop-universal-client'
import {ipc} from '@/ipc'
import {useSelectedAccountContacts} from '@/models/contacts'
import {useGatewayUrl} from '@/models/gateway-settings'
import {client} from '@/trpc'
import {useExperiments} from '@/models/experiments'
import {DAEMON_FILE_URL, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {NavRoute} from '@shm/shared/routes'
import {AppEvent, UniversalAppProvider} from '@shm/shared/routing'
import {
  NavAction,
  NavContextProvider,
  NavState,
  navStateReducer,
  useNavRoute,
} from '@shm/shared/utils/navigation'
import {streamSelector, writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {dialogBoxShadow, useAppDialog} from '@shm/ui/universal-dialog'
import {ReactQueryDevtools} from '@tanstack/react-query-devtools'
import {ReactNode} from 'react'
import {useAppContext} from '../app-context'
import {encodeRouteToPath} from './route-encoding'
import {AppWindowEvent} from './window-events'

const [updateNavState, navState] = writeableStateStream(window.initNavState)

const navigation = {
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

navigation.state.subscribe(() => {
  const state = navigation.state.get()
  ipc.send('windowNavState', state)
})

window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
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

export function NavigationContainer({children}: {children: ReactNode}) {
  const {externalOpen} = useAppContext()

  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL

  const experiments = useExperiments().data

  const contacts = useSelectedAccountContacts()

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
      experiments={experiments}
      openRouteNewWindow={(route: NavRoute) => {
        const path = encodeRouteToPath(route)
        const currentState = navigation.state.get()
        const selectedIdentity = currentState.selectedIdentity
        const accessoryWidth = currentState.accessoryWidth
        ipc.invoke('plugin:window|open', {
          path,
          selectedIdentity,
          accessoryWidth,
        })
      }}
      openUrl={(url: string) => {
        externalOpen(url)
      }}
      origin={gwUrl}
      hmUrlHref={true}
      selectedIdentity={navigation.selectedIdentity}
      setSelectedIdentity={(keyId: string | null) => {
        navigation.dispatch({type: 'selectedIdentity', value: keyId})
      }}
      universalClient={desktopUniversalClient}
      contacts={contacts.data}
      broadcastEvent={(event: AppEvent) => {
        // @ts-expect-error
        window.ipc?.broadcast(event)
      }}
    >
      <NavContextProvider value={navigation}>
        {children}
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
