import {useAccountList} from '@/models/accounts'
import {useChildrenActivity} from '@/models/library'
import {NewSubDocumentButton} from '@/pages/document'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {SubDocumentItem} from '@shm/ui/activity'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Folder} from 'lucide-react'
import {useTheme, XStack, YStack} from 'tamagui'

export function DirectoryPanel({docId}: {docId: UnpackedHypermediaId}) {
  const childrenActivity = useChildrenActivity(docId)
  const directory = childrenActivity.data
  const accounts = useAccountList()
  const theme = useTheme()

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
      <YStack padding="$4" jc="center" ai="center" gap="$4">
        <Folder className="size-25" color={theme.color6.val} />
        <SizableText color="muted" weight="medium" size="xl">
          There are no children documents
        </SizableText>
        <XStack padding="$3">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
        </XStack>
      </YStack>
    )
  }

  return (
    <ScrollArea>
      <div className="flex flex-col h-full gap-2 ">
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
        <div className="w-full mt-5">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
        </div>
      </div>
    </ScrollArea>
  )
}
