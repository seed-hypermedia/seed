import {useSubscribedResource} from '@/models/entities'
import {useDocumentChanges, useVersionChanges} from '@/models/versions'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {AccessoryContent} from '@shm/ui/accessories'
import {ChangeItem} from '@shm/ui/change-item'

export function VersionsPanel({docId}: {docId: UnpackedHypermediaId}) {
  const activeChangeIds = useVersionChanges(docId)
  const currentEntity = useSubscribedResource({...docId, version: null})
  const currentDocument =
    // @ts-ignore
    currentEntity.data?.type === 'document'
      ? // @ts-ignore
        currentEntity.data.document
      : undefined
  const changes = useDocumentChanges(docId)
  return (
    <AccessoryContent>
      {changes.data?.map((change, idx) => {
        const isActive = activeChangeIds?.has(change.id) || false
        return (
          <ChangeItem
            key={change.id}
            change={change}
            isActive={isActive}
            docId={docId}
            isLast={idx === changes.data.length - 1}
            isCurrent={change.id === currentDocument?.version}
            author={change.author}
          />
        )
      })}
    </AccessoryContent>
  )
}
