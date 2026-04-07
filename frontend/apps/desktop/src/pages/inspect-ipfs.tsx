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

  return <InspectIpfsPage ipfsPath={route.ipfsPath} exitRoute={exitRoute} getRouteForUrl={getRouteForUrl} />
}
