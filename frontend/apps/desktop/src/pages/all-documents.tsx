import {useNavigate} from '@/utils/useNavigate'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {AllDocumentsPage} from '@shm/ui/all-documents-page'

export default function AllDocumentsDesktopPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  if (route.key !== 'all-documents') return null
  return <AllDocumentsPage siteId={route.id} onNavigateToDocument={(id) => navigate({key: 'document', id})} />
}
