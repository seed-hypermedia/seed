import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {allDocumentsRouteFromState, allDocumentsStateFromRoute} from '@shm/shared/utils/all-documents-view'
import {AllDocumentsPage} from '@shm/ui/all-documents-page'

export function WebAllDocumentsPage({siteId}: {siteId: UnpackedHypermediaId}) {
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  const {originHomeId} = useUniversalAppContext()
  const route = useNavRoute()
  const state =
    route.key === 'all-documents'
      ? allDocumentsStateFromRoute(route)
      : allDocumentsStateFromRoute({key: 'all-documents', id: siteId})
  return (
    <AllDocumentsPage
      siteId={siteId}
      state={state}
      onStateChange={(next) => {
        replace(allDocumentsRouteFromState(siteId, next))
      }}
      onNavigateToDocument={(id, opts) => {
        const documentRoute = {key: 'document' as const, id}
        if (opts?.newWindow) {
          const href = routeToHref(documentRoute, {originHomeId})
          if (href) window.open(href, '_blank')
          return
        }
        navigate(documentRoute)
      }}
    />
  )
}
