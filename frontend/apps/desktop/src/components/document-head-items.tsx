import {hmId} from '@shm/shared'
import {HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResources} from '@shm/shared/models/entity'
import {DonateButton} from '@shm/ui/donate-button'

export function DocumentHeadItems({
  docId,
  document,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
}) {
  const authors = useResources(
    document.authors.map((author) => hmId(author)) || [],
  )
  return (
    <>
      <DonateButton
        authors={authors
          .map((author) => {
            // @ts-expect-error
            if (!author.data?.document) return null
            // @ts-expect-error
            return {id: author.data.id, metadata: author.data.document.metadata}
          })
          .filter((a) => !!a)}
        docId={docId}
      />
    </>
  )
}
