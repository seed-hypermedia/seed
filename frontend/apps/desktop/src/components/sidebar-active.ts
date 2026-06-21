import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '@shm/shared/routes'

/** Returns true when a nav route is viewing documents that belong to a site. */
export function isSiteDocumentsActiveRoute(route: NavRoute, siteId: UnpackedHypermediaId) {
  switch (route.key) {
    case 'document':
    case 'board':
    case 'all-documents':
    case 'comments':
    case 'activity':
    case 'directory':
    case 'collaborators':
    case 'feed':
      return route.id.uid === siteId.uid
    default:
      return false
  }
}
