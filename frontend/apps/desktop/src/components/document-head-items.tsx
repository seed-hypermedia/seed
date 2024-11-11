import {useMyAccountIds} from '@/models/daemon'
import {UnpackedHypermediaId} from '@shm/shared'
import {Check, SizableText, XStack} from '@shm/ui'

import {DonateButton} from './donate-button'
import {SubscriptionButton} from './subscription'
import {CopyReferenceButton} from './titlebar-common'

export function DocumentHeadItems({
  docId,
  isBlockFocused,
}: {
  docId: UnpackedHypermediaId
  isBlockFocused?: boolean
}) {
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
      <DonateButton docId={docId} />
      <CopyReferenceButton
        docId={docId}
        isBlockFocused={isBlockFocused || false}
        size="$2"
      />
    </>
  )
}
