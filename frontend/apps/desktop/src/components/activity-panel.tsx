import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {DocumentAccessory} from '@shm/shared/routes'
import {AccessoryContent} from './accessory-sidebar'
import {ActivityList} from './document-activity'

export function ActivityPanel({
  docId,
  onAccessory,
}: {
  docId: UnpackedHypermediaId
  onAccessory: (accessory: DocumentAccessory) => void
}) {
  return (
    <AccessoryContent>
      <ActivityList
        docId={docId}
        onCommentFocus={(commentId, isReplying) => {
          onAccessory({
            key: 'discussions',
            openComment: commentId,
            openBlockId: undefined,
            isReplying,
          })
        }}
      />
    </AccessoryContent>
  )
}
