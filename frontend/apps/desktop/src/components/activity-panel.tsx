import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {DocumentAccessory} from '@shm/shared/routes'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {View} from 'tamagui'
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
      <View paddingHorizontal="$2">
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
      </View>
    </ScrollArea>
  )
}
