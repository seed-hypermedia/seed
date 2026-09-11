import {useAppContext} from '@/app-context'
import {CloseButton} from '@/components/window-controls'
import {useGatewayUrl} from '@/models/gateway-settings'
import {
  createInspectIpfsNavRoute,
  createInspectNavRouteFromRoute,
  createRouteFromInspectNavRoute,
  hypermediaUrlToRoute,
} from '@shm/shared'
import {useNavigationState, useNavRoute} from '@shm/shared/utils/navigation'
import {getWindowType} from '@/utils/window-types'
import {pageFrameStyles} from '@shm/ui/container'
import {InspectIpfsPage} from '@shm/ui/inspect-ipfs-page'
import {useCallback, useMemo} from 'react'

/** Renders raw IPFS inspector content in the desktop app. */
export default function DesktopInspectIpfsPage() {
  const route = useNavRoute()
  const navState = useNavigationState()
  const {platform} = useAppContext()

  if (route.key !== 'inspect-ipfs') {
    throw new Error(`DesktopInspectIpfsPage: unsupported route ${route.key}`)
  }

  const getRouteForUrl = useCallback((url: string) => {
    if (url.startsWith('ipfs://')) {
      return createInspectIpfsNavRoute(url.slice('ipfs://'.length))
    }

    const targetRoute = hypermediaUrlToRoute(url)
    return targetRoute ? createInspectNavRouteFromRoute(targetRoute) : null
  }, [])

  const exitRoute = useMemo(() => {
    const previousRoute = navState && navState.routeIndex > 0 ? navState.routes[navState.routeIndex - 1] : null
    if (!previousRoute || previousRoute.key === 'inspect-ipfs') return null
    return previousRoute.key === 'inspect'
      ? createRouteFromInspectNavRoute(previousRoute, previousRoute.inspectTab)
      : previousRoute
  }, [navState])

  const isMac = platform === 'darwin'
  const gatewayUrl = useGatewayUrl().data || undefined
  // In its own chromeless window the page's header doubles as the title bar
  // (traffic-light inset, close button). In the main window it is a regular
  // page inside the rounded frame every page shares.
  const chromeless = getWindowType() === 'inspect-ipfs'
  const page = (
    <InspectIpfsPage
      ipfsPath={route.ipfsPath}
      editField={route.editField}
      exitRoute={exitRoute}
      getRouteForUrl={getRouteForUrl}
      gatewayUrl={gatewayUrl}
      trafficLightInset={chromeless && isMac}
      windowControls={
        chromeless && !isMac ? (
          <div className="no-window-drag flex size-[26px] items-center justify-center">
            <CloseButton />
          </div>
        ) : undefined
      }
    />
  )
  return chromeless ? page : <div className={pageFrameStyles}>{page}</div>
}
