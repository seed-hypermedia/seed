import {useMyAccountIds} from '@/models/daemon'
import {HMDocument, hmId, UnpackedHypermediaId} from '@shm/shared'
import {Check, SizableText, XStack} from '@shm/ui'

import {useEntities} from '@/models/entities'
import {DonateButton} from '@shm/ui'
import {SubscriptionButton} from './subscription'
import {CopyReferenceButton} from './titlebar-common'

export function DocumentHeadItems({
  docId,
  isBlockFocused,
  document,
}: {
  docId: UnpackedHypermediaId
  isBlockFocused?: boolean
  document: HMDocument
}) {
  const myAccountIds = useMyAccountIds()
  const docIsInMyAccount = myAccountIds.data?.includes(docId.uid)
  const authors = useEntities(
    document.authors.map((author) => hmId('d', author)) || [],
  )
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
      <DonateButton
        authors={authors
          .map((author) => {
            if (!author.data?.document) return null
            return {id: author.data.id, metadata: author.data.document.metadata}
          })
          .filter((a) => !!a)}
        docId={docId}
      />
      <CopyReferenceButton
        docId={docId}
        isBlockFocused={isBlockFocused || false}
        size="$2"
      />
    </>
  )
}
