import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useNavigate} from '@shm/shared/utils/navigation'
import {AllDocumentsPage} from '@shm/ui/all-documents-page'

export function WebAllDocumentsPage({siteId}: {siteId: UnpackedHypermediaId}) {
  const navigate = useNavigate()
  return <AllDocumentsPage siteId={siteId} onNavigateToDocument={(id) => navigate({key: 'document', id})} />
}
