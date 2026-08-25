import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '@shm/shared/routes'

/** Returns true when a nav route is viewing documents that belong to a space. */
export function isSpaceDocumentsActiveRoute(route: NavRoute, spaceId: UnpackedHypermediaId) {
  switch (route.key) {
    case 'document':
    case 'all-documents':
    case 'comments':
    case 'activity':
    case 'directory':
    case 'collaborators':
    case 'metadata':
    case 'feed':
      return route.id.uid === spaceId.uid
    default:
      return false
  }
}
