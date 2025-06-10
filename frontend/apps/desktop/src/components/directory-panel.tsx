import {useAccountList} from '@/models/accounts'
import {useChildrenActivity} from '@/models/library'
import {NewSubDocumentButton} from '@/pages/document'
import {useNavRoute} from '@/utils/navigation'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {SubDocumentItem} from '@shm/ui/activity'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {EmptyDiscussion} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useTheme, XStack, YStack} from 'tamagui'

export function DirectoryPanel({docId}: {docId: UnpackedHypermediaId}) {
  const childrenActivity = useChildrenActivity(docId)
  const directory = childrenActivity.data
  const accounts = useAccountList()
  const route = useNavRoute()
  const theme = useTheme()

  if (route.key !== 'document') return null
  const isInitialLoad = childrenActivity.isInitialLoading
  if (isInitialLoad) {
    return (
      <div className="flex justify-center items-center p-4">
        <Spinner />
      </div>
    )
  }
  if (directory.length == 0) {
    return (
      <YStack padding="$4" jc="center" ai="center" gap="$4">
        <EmptyDiscussion color={theme.color6.val} />
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
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 py-2 px-4 h-full">
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
        <div className="mt-5 w-full">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
        </div>
      </div>
    </ScrollArea>
  )
}
