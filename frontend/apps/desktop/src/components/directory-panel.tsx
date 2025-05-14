import {useAccountList} from '@/models/accounts'
import {useChildrenActivity} from '@/models/library'
import {NewSubDocumentButton} from '@/pages/document'
import {useNavRoute} from '@/utils/navigation'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {SubDocumentItem} from '@shm/ui/activity'
import {EmptyDiscussion} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {ScrollView, SizableText, useTheme, XStack, YStack} from 'tamagui'

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
      <YStack padding="$4" jc="center" ai="center" gap="$4">
        <Spinner />
      </YStack>
    )
  }
  if (directory.length == 0) {
    return (
      <YStack padding="$4" jc="center" ai="center" gap="$4">
        <EmptyDiscussion color={theme.color6.val} />
        <SizableText color="$color7" fontWeight="500" size="$5">
          There are no children documents
        </SizableText>
      </YStack>
    )
  }

  return (
    <ScrollView>
      <YStack gap="$2" paddingHorizontal="$2">
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
        <XStack padding="$3">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
        </XStack>
      </YStack>
    </ScrollView>
  )
}
