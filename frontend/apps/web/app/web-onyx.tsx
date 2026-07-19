import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {OnyxTour} from '@shm/ui/onyx/index'

/** Parse a reserved `/hm/onyx/…` URL back to an onyx route (mirrors routeToHref). */
export function extractOnyxRouteFromPath(pathParts: string[]): {key: 'onyx'; slug?: string} | null {
  if (pathParts[0] !== 'hm' || pathParts[1] !== 'onyx') return null
  const rest = pathParts.slice(2)
  return rest[0] ? {key: 'onyx', slug: rest.join('/')} : {key: 'onyx'}
}

/** Full-page in-app Onyx schema explorer ("the tour") for the web app. */
export function WebOnyxPage() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  if (route.key !== 'onyx') {
    throw new Error(`WebOnyxPage: unsupported route ${route.key}`)
  }
  return <OnyxTour slug={route.slug || 'onyx-schema'} onNavigate={(slug) => navigate({key: 'onyx', slug})} />
}
