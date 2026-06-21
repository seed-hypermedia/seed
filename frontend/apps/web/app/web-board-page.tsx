import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {BoardAppViewPage} from '@shm/ui/board-page'

export function WebBoardPage({siteId}: {siteId: UnpackedHypermediaId}) {
  const navigate = useNavigate()
  const {originHomeId} = useUniversalAppContext()
  return (
    <BoardAppViewPage
      siteId={siteId}
      onNavigateToDocument={(id, opts) => {
        const route = {key: 'document' as const, id}
        if (opts?.newWindow) {
          const href = routeToHref(route, {originHomeId})
          if (href) window.open(href, '_blank')
          return
        }
        navigate(route)
      }}
    />
  )
}
