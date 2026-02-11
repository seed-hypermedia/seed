import {UnpackedHypermediaId} from '@shm/shared'
import {CommentsProvider} from '@shm/shared/comments-service-provider'
import {FeedPage} from '@shm/ui/feed-page-common'
import {WebAccountFooter, useWebMenuItems} from './web-common'

export function WebFeedPage({docId}: {docId: UnpackedHypermediaId}) {
  const menuItems = useWebMenuItems(docId)

  return (
    <WebAccountFooter>
      <CommentsProvider>
        <FeedPage docId={docId} optionsMenuItems={menuItems} />
      </CommentsProvider>
    </WebAccountFooter>
  )
}
