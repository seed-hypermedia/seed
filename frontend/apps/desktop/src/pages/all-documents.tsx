import {useNavigate} from '@/utils/useNavigate'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {allDocumentsRouteFromState, allDocumentsStateFromRoute} from '@shm/shared/utils/all-documents-view'
import {AllDocumentsPage} from '@shm/ui/all-documents-page'

export default function AllDocumentsDesktopPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  const spawn = useNavigate('spawn')
  if (route.key !== 'all-documents') return null
  const state = allDocumentsStateFromRoute(route)
  return (
    <AllDocumentsPage
      siteId={route.id}
      state={state}
      onStateChange={(next) => {
        replace(allDocumentsRouteFromState(route.id, next))
      }}
      onNavigateToDocument={(id, opts) => {
        const documentRoute = {key: 'document' as const, id}
        if (opts?.newWindow) spawn(documentRoute)
        else navigate(documentRoute)
      }}
    />
  )
}
