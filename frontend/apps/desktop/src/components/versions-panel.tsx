import {useSubscribedEntity} from '@/models/entities'
import {useDocumentChanges, useVersionChanges} from '@/models/versions'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {ChangeItem} from '@shm/ui/change-item'
import {AccessoryContent} from './accessory-sidebar'

export function VersionsPanel({docId}: {docId: UnpackedHypermediaId}) {
  const activeChangeIds = useVersionChanges(docId)
  const currentEntity = useSubscribedEntity({...docId, version: null})
  const changes = useDocumentChanges(docId)
  return (
    <AccessoryContent>
      <div>
        {changes.data?.map((change, idx) => {
          const isActive = activeChangeIds?.has(change.id) || false
          return (
            <ChangeItem
              key={change.id}
              change={change}
              isActive={isActive}
              docId={docId}
              isLast={idx === changes.data.length - 1}
              isCurrent={change.id === currentEntity.data?.document?.version}
              author={change.author}
            />
          )
        })}
      </div>
    </AccessoryContent>
  )
}
