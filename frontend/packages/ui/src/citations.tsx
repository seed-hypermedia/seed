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
import {Button} from './button'
import {HoverCard} from './hover-card'
import {cn} from './utils'

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
    <div className="flex items-center gap-1 flex-wrap py-1 ">
      <HMAuthor author={citation.author} />
      <SizableText size="sm" className="text-muted-foreground px-2 py-1">
        {formattedDateShort(citation.source.time)}
      </SizableText>

      <SizableText size="sm">{`${tx('cited on')} `}</SizableText>
      <DocumentCitationToken
        docId={citation.source.id}
        metadata={citation.document.metadata}
        DocPreview={DocPreview}
      />
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
  const className =
    'text-sm bg-secondary border border-brand-11 px-1 py-0 rounded mt-1.5 whitespace-wrap break-all hover:bg-brand-11 active:bg-brand-10'
  if (DocPreview) {
    return (
      <HoverCard content={<DocPreview metadata={metadata} docId={docId} />}>
        <a
          {...linkProps}
          className={cn(className, 'text-secondary-foreground')}
        >
          {metadata?.name}
        </a>
      </HoverCard>
    )
  }
  return (
    <a {...linkProps} className={className}>
      {metadata?.name}
    </a>
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
