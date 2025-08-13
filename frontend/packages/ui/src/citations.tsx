import {
  HMDocumentCitation,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {NavRoute} from '@shm/shared/routes'
import {useTx} from '@shm/shared/translation'
import {ContactToken} from './contact-token'
import {EventDescriptionText, EventRowInline, EventTimestamp} from './feed'
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
  const route: NavRoute = {
    key: 'document',
    id: citation.source.id,
  }
  return (
    <EventRowInline route={route}>
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
    </EventRowInline>
  )
}
