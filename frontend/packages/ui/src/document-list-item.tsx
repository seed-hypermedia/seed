import {
  formattedDate,
  getMetadataName,
  HMAccountsMetadata,
  HMActivitySummary,
  HMBreadcrumb,
  HMComment,
  HMDocumentInfo,
  HMLibraryDocument,
  InteractionSummaryPayload,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {MessageSquare} from 'lucide-react'
import {LibraryEntryUpdateSummary} from './activity'
import {Button} from './button'
import {FacePile} from './face-pile'
import {HMIcon} from './hm-icon'
import {SizableText} from './text'
import {cn} from './utils'

export type DocumentListItemData =
  | HMDocumentInfo
  | (HMLibraryDocument & {breadcrumbs?: HMBreadcrumb[]})

interface DocumentListItemProps {
  item: DocumentListItemData
  accountsMetadata?: HMAccountsMetadata
  breadcrumbs?: HMBreadcrumb[]
  activitySummary?: HMActivitySummary | null
  latestComment?: HMComment | null
  interactionSummary?: InteractionSummaryPayload | null
  isRead?: boolean
  indent?: boolean
  onClick?: (id: UnpackedHypermediaId) => void
  className?: string
}

export function DocumentListItem({
  item,
  className,
  accountsMetadata,
  breadcrumbs,
  activitySummary,
  latestComment,
  interactionSummary,
  isRead,
  indent = false,
  onClick,
}: DocumentListItemProps) {
  const id = item.id

  const metadata = item.metadata
  const itemActivitySummary =
    activitySummary !== undefined
      ? activitySummary
      : 'activitySummary' in item
      ? item.activitySummary
      : null
  const itemLatestComment =
    latestComment !== undefined
      ? latestComment
      : 'latestComment' in item
      ? item.latestComment
      : null
  const itemBreadcrumbs =
    breadcrumbs !== undefined
      ? breadcrumbs
      : 'breadcrumbs' in item
      ? item.breadcrumbs
      : null
  const computedIsRead =
    isRead !== undefined ? isRead : !itemActivitySummary?.isUnread

  const showAuthors =
    !!accountsMetadata && Object.keys(accountsMetadata).length > 0

  const linkProps = useRouteLink({key: 'document', id})

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Stop propagation to prevent parent handlers (like EmbedWrapper) from firing
    e.stopPropagation()

    if (onClick) {
      onClick(id)
    } else if (linkProps?.onClick) {
      linkProps.onClick(e)
    }
  }

  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        'h-auto w-full items-center justify-start border-none bg-transparent bg-white px-4 py-2 shadow-sm hover:shadow-md dark:bg-black',
        className,
      )}
    >
      <a data-resourceid={id.id} {...linkProps} onClick={handleClick}>
        {indent && <div className="size-8 shrink-0" />}
        <HMIcon size={28} id={id} name={metadata?.name} icon={metadata?.icon} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {itemBreadcrumbs && itemBreadcrumbs.length > 1 && (
            <DocumentListItemBreadcrumbs breadcrumbs={itemBreadcrumbs} />
          )}
          <div className="flex flex-1 items-center gap-3">
            <div className="items-center-justify-start flex flex-1 overflow-hidden">
              <SizableText
                className={cn('flex-1 truncate text-left font-sans')}
                weight={computedIsRead ? undefined : 'bold'}
              >
                {getMetadataName(metadata)}
              </SizableText>
            </div>
            {interactionSummary && interactionSummary.comments > 0 && (
              <DocumentListItemCommentCount
                count={interactionSummary.comments}
              />
            )}
            {showAuthors && (
              <FacePile
                accounts={item.authors}
                accountsMetadata={accountsMetadata}
              />
            )}
            {!showAuthors && !itemActivitySummary && (
              <SizableText size="xs" color="muted" className="font-sans">
                {formattedDate(item.updateTime)}
              </SizableText>
            )}
          </div>
          {itemActivitySummary && (
            <LibraryEntryUpdateSummary
              accountsMetadata={accountsMetadata}
              latestComment={itemLatestComment}
              activitySummary={itemActivitySummary}
            />
          )}
        </div>
      </a>
    </Button>
  )
}

function DocumentListItemBreadcrumbs({
  breadcrumbs,
}: {
  breadcrumbs: HMBreadcrumb[]
}) {
  const displayCrumbs = breadcrumbs.slice(1).filter((crumb) => !!crumb.name)
  if (!displayCrumbs.length) return null
  return (
    <div className="flex gap-1">
      {displayCrumbs.map((breadcrumb, idx) => (
        <>
          <Button
            key={breadcrumb.name}
            variant="link"
            className="px-0 text-[10px]"
            size="xs"
            onClick={(e) => {
              e.stopPropagation()
              // Navigation will be handled by parent if needed
            }}
          >
            {breadcrumb.name}
          </Button>
          {idx === displayCrumbs.length - 1 ? null : (
            <SizableText
              key={`separator-${idx}`}
              className="text-muted-foreground text-sm"
            >
              /
            </SizableText>
          )}
        </>
      ))}
    </div>
  )
}

function DocumentListItemCommentCount({count}: {count: number}) {
  if (!count) return null
  return (
    <div className="flex items-center gap-1">
      <MessageSquare className="text-muted-foreground size-3" />
      <SizableText className="text-muted-foreground text-[10px]">
        {count}
      </SizableText>
    </div>
  )
}
