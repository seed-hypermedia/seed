import {getWindowTitle} from '@/hooks/route-breadcrumbs'
import {useDraft} from '@/models/accounts'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getDocumentTitle} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {getDraftIdFromDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import type {NavRoute} from '@shm/shared/routes'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useEffect} from 'react'

function getRouteResourceId(route: NavRoute): UnpackedHypermediaId | null {
  switch (route.key) {
    case 'contact':
    case 'profile':
    case 'site-profile':
    case 'document':
    case 'feed':
    case 'directory':
    case 'all-documents':
    case 'collaborators':
    case 'activity':
    case 'comments':
    case 'metadata':
    case 'inspect':
    case 'site-settings':
      return route.id
    default:
      return null
  }
}

/** Synchronizes the current desktop page name to Electron's native window title. */
export function WindowTitle() {
  const route = useNavRoute()
  const resourceId = getRouteResourceId(route)
  // An unpublished draft has no daemon resource and its path slug is a placeholder id, so the
  // title comes from the local draft instead, falling back to a readable label.
  const draftId = getDraftIdFromDraftPathSegment(resourceId?.path?.at(-1)) ?? undefined
  const draft = useDraft(draftId)
  const resource = useResource(draftId ? null : resourceId)
  const activeName = draftId
    ? draft.data?.metadata?.name || 'Untitled Document'
    : resource.data?.type === 'document'
      ? getDocumentTitle(resource.data.document) || undefined
      : undefined
  const title = getWindowTitle(route, activeName)

  useEffect(() => {
    document.title = title
  }, [title])

  return null
}
