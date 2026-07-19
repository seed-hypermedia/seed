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
  return (
    <InspectIpfsPage
      ipfsPath={route.ipfsPath}
      exitRoute={exitRoute}
      getRouteForUrl={getRouteForUrl}
      gatewayUrl={gatewayUrl}
      trafficLightInset={isMac}
      windowControls={
        isMac ? undefined : (
          <div className="no-window-drag flex size-[26px] items-center justify-center">
            <CloseButton />
          </div>
        )
      }
    />
  )
}
