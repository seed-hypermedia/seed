import {
  HMDocumentCitation,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useTx, useTxUtils} from '@shm/shared/translation'
import {ContactToken} from './contact-token'
import {EventDescriptionText, EventRow, EventTimestamp} from './feed'
import {ResourceToken} from './resource-token'

export function DocumentCitationEntry({
  citation,
  ResourcePreview,
}: {
  citation: HMDocumentCitation
  ResourcePreview?: React.ComponentType<{
    metadata?: HMMetadata | null
    id: UnpackedHypermediaId
  }>
}) {
  if (!citation.author || !citation.document) return null
  const tx = useTx()
  const {formattedDateShort} = useTxUtils()
  return (
    <EventRow>
      <ContactToken
        id={citation.author.id}
        metadata={citation.author.metadata}
        ResourcePreview={ResourcePreview}
      />
      <EventTimestamp time={citation.source.time} />
      <EventDescriptionText>{`${tx('cited on')} `}</EventDescriptionText>
      <ResourceToken
        id={citation.source.id}
        metadata={citation.document.metadata}
        ResourcePreview={ResourcePreview}
      />
    </EventRow>
  )
}
