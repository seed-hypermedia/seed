import {useMyAccountIds} from '@/models/daemon'
import {UnpackedHypermediaId} from '@shm/shared'
import {Check, SizableText, XStack} from '@shm/ui'
import {FavoriteButton} from './favoriting'
import {SubscriptionButton} from './subscription'

export function DocumentHeadItems({docId}: {docId: UnpackedHypermediaId}) {
  const myAccountIds = useMyAccountIds()
  const docIsInMyAccount = myAccountIds.data?.includes(docId.uid)
  return (
    <>
      <FavoriteButton id={docId} />
      {docIsInMyAccount ? (
        <XStack ai="center" gap="$2">
          <Check color="green" />
          <SizableText userSelect="none" color="$green10" size="$2">
            Subscribed
          </SizableText>
        </XStack>
      ) : (
        <SubscriptionButton id={docId} />
      )}
    </>
  )
}
