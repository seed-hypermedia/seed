import {useEntities} from '@/models/entities'
import {HMDocument} from '@shm/shared/hm-types'
import {hmId, UnpackedHypermediaId} from '@shm/shared/utils/entity-id-url'
import {DonateButton} from '@shm/ui'

export function DocumentHeadItems({
  docId,
  document,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
}) {
  const authors = useEntities(
    document.authors.map((author) => hmId('d', author)) || [],
  )
  return (
    <>
      <DonateButton
        authors={authors
          .map((author) => {
            if (!author.data?.document) return null
            return {id: author.data.id, metadata: author.data.document.metadata}
          })
          .filter((a) => !!a)}
        docId={docId}
      />
    </>
  )
}
