import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {DocumentAccessory} from '@shm/shared/routes'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {ActivityList} from './document-activity'

export function ActivityPanel({
  docId,
  onAccessory,
}: {
  docId: UnpackedHypermediaId
  onAccessory: (accessory: DocumentAccessory) => void
}) {
  return (
    <ScrollArea>
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
    </ScrollArea>
  )
}
