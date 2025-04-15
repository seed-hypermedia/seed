import {formattedDateShort, useRouteLink} from '@shm/shared'
import {
  HMDocumentCitation,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {HMIcon} from '@shm/ui/hm-icon'
import {Button, SizableText, styled, XStack} from 'tamagui'

export function DocumentCitationEntry({
  citation,
  DocPreview,
}: {
  citation: HMDocumentCitation
  DocPreview?: React.ComponentType<{
    metadata?: HMMetadata | null
    docId: UnpackedHypermediaId
  }>
}) {
  if (!citation.author || !citation.document) return null
  return (
    <XStack gap="$1" ai="center" flexWrap="wrap">
      <HMAuthor author={citation.author} />
      <CitationDateText>
        {formattedDateShort(citation.source.time)}
      </CitationDateText>
      <XStack gap="$2" ai="center">
        <SizableText>cited on</SizableText>
        <DocumentCitationToken
          docId={citation.source.id}
          metadata={citation.document.metadata}
          DocPreview={DocPreview}
        />
      </XStack>
    </XStack>
  )
}

function DocumentCitationToken({
  docId,
  metadata,
  DocPreview,
}: {
  docId: UnpackedHypermediaId
  metadata?: HMMetadata | null
  DocPreview?: React.ComponentType<{
    metadata?: HMMetadata | null
    docId: UnpackedHypermediaId
  }>
}) {
  const linkProps = useRouteLink({key: 'document', id: docId})
  if (DocPreview) {
    return (
      <DocumentCitationButton {...linkProps}>
        {metadata?.name}
      </DocumentCitationButton>
    )
  }
  return (
    <DocumentCitationButton {...linkProps}>
      {metadata?.name}
    </DocumentCitationButton>
  )
}

function HMAuthor({author}: {author: HMMetadataPayload}) {
  const linkProps = useRouteLink({key: 'document', id: author.id})
  return (
    <Button size="$2" chromeless {...linkProps}>
      <XStack gap="$2" ai="center">
        <HMIcon size={20} id={author.id} metadata={author.metadata} />
        <SizableText fontWeight="bold">{author.metadata?.name}</SizableText>
      </XStack>
    </Button>
  )
}

const CitationDateText = styled(SizableText, {
  color: '$color8',
  marginRight: '$2',
})

const DocumentCitationButton = styled(Button, {
  backgroundColor: '$color6',
  size: '$1',
  fontSize: '$4',
  hoverStyle: {
    backgroundColor: '$color2',
  },
})
