import {
  formattedDateDayOnly,
  getDocumentImage,
  HMAccountsMetadata,
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
  const linkProps = useRouteLink(docId ? {key: 'document', id: docId} : null, {
    handler: 'onClick',
  })
  const imageUrl = useImageUrl()

  let textContent = useMemo(() => {
    if (entity?.document?.metadata?.summary) {
      return entity.document.metadata.summary
    }
    return plainTextOfContent(entity?.document?.content)
  }, [entity?.document])

  const coverImage = entity?.document
    ? getDocumentImage(entity?.document)
    : undefined

  return (
    // @ts-expect-error
    <div
      data-docid={docId?.id}
      className={cn(
        'hover:bg-accent dark:hover:bg-accent @container min-h-[200px] flex-1 overflow-hidden rounded-lg bg-white shadow-md transition-colors duration-300 dark:bg-black',
        banner && 'rounded-xl md:min-h-[240px] lg:min-h-[280px]',
      )}
      onMouseEnter={docId ? () => onHoverIn?.(docId) : undefined}
      onMouseLeave={docId ? () => onHoverOut?.(docId) : undefined}
      {...(navigate ? linkProps : {})}
      {...props}
    >
      <div className="flex h-full max-w-full flex-1 cursor-pointer flex-col @md:flex-row">
        {coverImage && (
          <div
            className={cn(
              'relative h-40 w-full shrink-0 @md:min-h-full @md:w-1/2',
              banner && '@md:h-[280px]',
            )}
          >
            <img
              className="absolute top-0 left-0 h-full w-full object-cover"
              src={imageUrl(coverImage, 'L')}
              alt=""
            />
          </div>
        )}
        <div className={cn('flex flex-1 flex-col justify-between')}>
          <div className="p-4">
            <p
              className={cn(
                'text-foreground block font-sans leading-tight! font-bold',
                banner ? 'text-2xl' : 'text-lg',
              )}
            >
              {entity?.document?.metadata?.name}
            </p>
            <p
              className={cn(
                'text-muted-foreground mt-2 line-clamp-3 font-sans',
                !banner && 'text-sm',
              )}
            >
              {textContent}
            </p>
          </div>
          <div className="flex items-center justify-between py-1 pr-2 pl-4">
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
