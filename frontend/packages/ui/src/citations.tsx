import {useRouteLink} from '@shm/shared'
import {
  HMDocumentCitation,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useTx, useTxUtils} from '@shm/shared/translation'
import {HMIcon} from '@shm/ui/hm-icon'
import {SizableText} from '@shm/ui/text'
import {Button} from './components/button'
import {HoverCard} from './hover-card'

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
  const tx = useTx()
  const {formattedDateShort} = useTxUtils()
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <HMAuthor author={citation.author} />
      <SizableText className="text-muted-foreground mr-2">
        {formattedDateShort(citation.source.time)}
      </SizableText>
      <div className="flex items-center gap-2">
        <SizableText>{tx('cited on')}</SizableText>
        <DocumentCitationToken
          docId={citation.source.id}
          metadata={citation.document.metadata}
          DocPreview={DocPreview}
        />
      </div>
    </div>
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
      <HoverCard content={<DocPreview metadata={metadata} docId={docId} />}>
        <Button
          variant="ghost"
          size="xs"
          className="text-sm bg-accent"
          {...linkProps}
        >
          {metadata?.name}
        </Button>
      </HoverCard>
    )
  }
  return (
    <Button variant="brand" size="sm" className="text-sm" {...linkProps}>
      {metadata?.name}
    </Button>
  )
}

function HMAuthor({author}: {author: HMMetadataPayload}) {
  const linkProps = useRouteLink({key: 'document', id: author.id})
  return (
    <Button variant="ghost" size="sm" {...linkProps}>
      <HMIcon size={20} id={author.id} metadata={author.metadata} />
      <SizableText weight="bold">{author.metadata?.name}</SizableText>
    </Button>
  )
}
