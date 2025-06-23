import {
  formattedDateDayOnly,
  HMAccountsMetadata,
  HMBlock,
  HMBlockNode,
  HMDocument,
  HMEntityContent,
  plainTextOfContent,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useImageUrl} from '@shm/ui/get-file-url'
import {HTMLAttributes, useMemo} from 'react'
import {useDocContentContext} from './document-content'
import {FacePile} from './face-pile'
import {SizableText} from './text'
import {cn} from './utils'

export function DocumentCard({
  docId,
  entity,
  accountsMetadata,
  isWeb = false,
  navigate = true,
  onMouseEnter,
  onMouseLeave,
  banner = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  docId: UnpackedHypermediaId
  entity: HMEntityContent | null | undefined
  accountsMetadata: HMAccountsMetadata
  isWeb?: boolean
  navigate?: boolean
  onMouseEnter?: (id: UnpackedHypermediaId) => void
  onMouseLeave?: (id: UnpackedHypermediaId) => void
  banner?: boolean
}) {
  const {onHoverIn, onHoverOut} = useDocContentContext()
  if (!entity?.document) return null

  const linkProps = useRouteLink(docId ? {key: 'document', id: docId} : null)

  const imageUrl = useImageUrl()

  let textContent = useMemo(() => {
    return plainTextOfContent(entity?.document?.content)
  }, [entity?.document])

  const coverImage = getDocumentCardImage(entity?.document)

  if (banner) {
    console.log('linkProps', docId, linkProps)
  }

  return (
    <div
      data-docid={docId?.id}
      className={cn(
        'bg-white dark:bg-background rounded-lg shadow-md overflow-hidden flex-1 @container hover:bg-brand-12 transition-colors duration-300 min-h-[200px]',
        banner && 'md:min-h-[240px] lg:min-h-[280px] rounded-xl',
      )}
      onMouseEnter={docId ? () => onHoverIn?.(docId) : undefined}
      onMouseLeave={docId ? () => onHoverOut?.(docId) : undefined}
      {...(navigate ? linkProps : {})}
      {...props}
    >
      <div className="flex flex-col @md:flex-row flex-1 h-full cursor-pointer max-w-full">
        {coverImage && (
          <div
            className={cn(
              'shrink-0 h-40 w-full @md:w-1/2 @md:min-h-full relative',
              banner && '@md:h-[280px] ',
            )}
          >
            <img
              className="h-full w-full object-cover absolute top-0 left-0"
              src={imageUrl(coverImage, 'L')}
              alt=""
            />
          </div>
        )}
        <div className={cn('flex-1 flex flex-col justify-between')}>
          <div className="p-4">
            <p
              className={cn(
                'block font-bold font-sans text-black leading-tight!',
                banner ? 'text-2xl' : 'text-lg',
              )}
            >
              {entity?.document?.metadata?.name}
            </p>
            <p
              className={cn(
                'mt-2 text-muted-foreground font-sans line-clamp-3',
                !banner && 'text-sm',
              )}
            >
              {textContent}
            </p>
          </div>
          <div className="pl-4 pr-2 py-1 flex items-center justify-between">
            {(entity?.document?.metadata?.displayPublishTime ||
              entity?.document?.updateTime) && (
              <SizableText
                color="muted"
                size="xs"
                className="font-sans opacity-75 hover:cursor-default"
              >
                {entity?.document?.metadata?.displayPublishTime
                  ? formattedDateDayOnly(
                      new Date(entity.document.metadata.displayPublishTime),
                    )
                  : formattedDateDayOnly(entity.document.updateTime)}
              </SizableText>
            )}
            <FacePile
              accounts={entity?.document?.authors || []}
              accountsMetadata={accountsMetadata}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function getDocumentCardImage(document: HMDocument): string | null {
  const coverImage = document.metadata.cover
  if (coverImage) return coverImage
  const firstImageBlock = findFirstBlock(
    document.content,
    (block) => block.type === 'Image' && !!block.link,
  )
  if (firstImageBlock) return firstImageBlock.link || null
  return null
}

function findFirstBlock(
  content: HMBlockNode[],
  test: (block: HMBlock) => boolean,
): HMBlock | null {
  let found: HMBlock | null = null
  let index = 0
  while (!found && index < content.length) {
    const blockNode = content[index]
    if (test(blockNode.block)) {
      found = blockNode.block
      break
    }
    const foundChild =
      blockNode.children && findFirstBlock(blockNode.children, test)
    if (foundChild) {
      found = foundChild
      break
    }
    index++
  }
  return found
}
