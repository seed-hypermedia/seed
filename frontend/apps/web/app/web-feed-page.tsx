import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {CommentsProvider} from '@shm/shared/comments-service-provider'
import {FeedPage} from '@shm/ui/feed-page-common'
import {WebAccountFooter, useWebMenuItems} from './web-utils'

export function WebFeedPage({docId}: {docId: UnpackedHypermediaId}) {
  const menuItems = useWebMenuItems()

  return (
    <WebAccountFooter siteUid={docId.uid}>
      <CommentsProvider>
        <FeedPage docId={docId} extraMenuItems={menuItems} />
      </CommentsProvider>
    </WebAccountFooter>
  )
}
