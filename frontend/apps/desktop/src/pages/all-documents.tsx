import {useNavigate} from '@/utils/useNavigate'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {AllDocumentsPage} from '@shm/ui/all-documents-page'

export default function AllDocumentsDesktopPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const spawn = useNavigate('spawn')
  if (route.key !== 'all-documents') return null
  return (
    <AllDocumentsPage
      siteId={route.id}
      onNavigateToDocument={(id, opts) => {
        const documentRoute = {key: 'document' as const, id}
        if (opts?.newWindow) spawn(documentRoute)
        else navigate(documentRoute)
      }}
    />
  )
}
