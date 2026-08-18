import {type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {type NavRoute} from '@shm/shared/routes'
import {extractViewTermFromUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {type NavMode} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {getAgentsPlatform} from './platform'

/** Navigates to a NavRoute using the host app's navigation (push/replace/spawn). */
export function useNavigate(mode: NavMode = 'push') {
  return getAgentsPlatform().useNavigate(mode)
}

/** Click handler that navigates in place, or spawns a new window on meta/shift-click. */
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

/** Returns the host app's URL opener: hm:// links in-app, http links externally. */
export function useOpenUrl() {
  return getAgentsPlatform().useOpenUrl()
}

/** Resolves a Hypermedia URL into an app route and base id for navigation or public URL generation. */
export function resolveHypermediaRoute(url: string): {
  id: UnpackedHypermediaId
  route: NavRoute
} | null {
  const route = hypermediaUrlToRoute(url)
  if (!route) return null

  const {url: cleanUrl} = extractViewTermFromUrl(url)
  const unpacked = unpackHmId(cleanUrl)
  if (!unpacked) return null

  return {
    id: unpacked,
    route,
  }
}
