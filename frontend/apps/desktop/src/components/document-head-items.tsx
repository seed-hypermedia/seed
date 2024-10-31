import {useMyAccountIds} from '@/models/daemon'
import {UnpackedHypermediaId} from '@shm/shared'
import {Check, SizableText, XStack} from '@shm/ui'

import {SubscriptionButton} from './subscription'

export function DocumentHeadItems({docId}: {docId: UnpackedHypermediaId}) {
  const myAccountIds = useMyAccountIds()
  const docIsInMyAccount = myAccountIds.data?.includes(docId.uid)
  return (
    <>
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
