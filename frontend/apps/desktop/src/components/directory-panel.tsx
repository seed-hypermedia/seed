import {useAccountList} from '@/models/accounts'
import {useChildrenActivity} from '@/models/library'
import {NewSubDocumentButton} from '@/pages/document'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {SubDocumentItem} from '@shm/ui/activity'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Folder} from 'lucide-react'
import {AccessoryContent} from './accessory-sidebar'

export function DirectoryPanel({docId}: {docId: UnpackedHypermediaId}) {
  const childrenActivity = useChildrenActivity(docId)
  const directory = childrenActivity.data
  const accounts = useAccountList()

  const isInitialLoad = childrenActivity.isInitialLoading
  if (isInitialLoad) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }
  if (directory.length == 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-4">
        <Folder className="text-muted-foreground size-25" />
        <SizableText color="muted" weight="medium" size="xl">
          There are no children documents
        </SizableText>
        <div className="flex p-3">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
        </div>
      </div>
    )
  }

  return (
    <AccessoryContent
      header={
        <NewSubDocumentButton locationId={docId} importDropdown={false} />
      }
    >
      <div className="flex h-full flex-col gap-2">
        {directory.map((activityItem) => {
          if (activityItem.type === 'document') {
            return (
              <SubDocumentItem
                hideIcon
                item={activityItem}
                key={activityItem.account + '/' + activityItem.path.join('/')}
                accountsMetadata={accounts.data?.accountsMetadata || {}}
              />
            )
          }
          return null
        })}
      </div>
    </AccessoryContent>
  )
}
