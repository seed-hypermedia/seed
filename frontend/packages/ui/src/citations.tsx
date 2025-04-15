import {formattedDateShort, useRouteLink} from '@shm/shared'
import {
  HMDocumentCitation,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {HMIcon} from '@shm/ui/hm-icon'
import {Button, SizableText, styled, XStack} from 'tamagui'

export function WebCitationEntry({citation}: {citation: HMDocumentCitation}) {
  if (citation.source.type === 'c') {
    return null
  }
  if (citation.source.type === 'd') {
    return <DocumentCitationEntry citation={citation} />
  }
  return <SizableText>Unsupported Citation Type</SizableText>
}

function DocumentCitationEntry({citation}: {citation: HMDocumentCitation}) {
  const doc = useEntity(citation.source.id)
  if (!doc.data) return null
  const author = citation.author
  if (!author) return null
  return (
    <XStack gap="$1" ai="center" flexWrap="wrap">
      <HMAuthor author={author} />
      <CitationDateText>
        {formattedDateShort(citation.source.time)}
      </CitationDateText>
      <XStack gap="$2" ai="center">
        <SizableText>cited on</SizableText>
        <DocumentCitationToken
          docId={doc.data.id}
          metadata={doc.data?.document?.metadata}
        />
      </XStack>
    </XStack>
  )
}

function DocumentCitationToken({
  docId,
  metadata,
}: {
  docId: UnpackedHypermediaId
  metadata?: HMMetadata | null
}) {
  const linkProps = useRouteLink({key: 'document', id: docId})
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
