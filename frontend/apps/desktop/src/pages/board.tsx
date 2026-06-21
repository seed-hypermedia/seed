import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {BoardAppViewPage} from '@shm/ui/board-page'

export default function BoardDesktopPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const spawn = useNavigate('spawn')
  if (route.key !== 'board') return null
  return (
    <BoardAppViewPage
      siteId={hmId(route.id.uid)}
      onNavigateToDocument={(id, opts) => {
        const documentRoute = {key: 'document' as const, id}
        if (opts?.newWindow) spawn(documentRoute)
        else navigate(documentRoute)
      }}
    />
  )
}
