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
import {HoverCard, HoverCardContent, HoverCardTrigger} from './/hover-card'
import {Button} from './button'
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
    <div className="flex flex-wrap items-center gap-1 py-1">
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
  const linkProps = useRouteLink(
    {key: 'document', id: docId},
    {handler: 'onClick'},
  )
  const className =
    'text-sm bg-gray-200 border border-gray-300 px-1 py-0 rounded mt-1.5 whitespace-wrap break-all'
  if (DocPreview) {
    return (
      <HoverCard>
        <HoverCardTrigger>
          <a
            {...linkProps}
            className={cn(
              className,
              'dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 hover:dark:border-gray-600 hover:dark:text-white',
              // 'dark:bg-brand-12 dark:border-brand-11 dark:text-gray-200',
              'text-secondary-foreground',
            )}
          >
            {metadata?.name}
          </a>
        </HoverCardTrigger>
        <HoverCardContent className="w-full max-w-100 p-0" align="end">
          <DocPreview metadata={metadata} docId={docId} />
        </HoverCardContent>
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
  const linkProps = useRouteLink(
    {key: 'document', id: author.id},
    {handler: 'onClick'},
  )
  return (
    <Button variant="ghost" size="sm" {...linkProps}>
      <HMIcon size={20} id={author.id} metadata={author.metadata} />
      <SizableText weight="bold">{author.metadata?.name}</SizableText>
    </Button>
  )
}
