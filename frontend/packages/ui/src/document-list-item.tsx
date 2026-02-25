import {
  formattedDate,
  getMetadataName,
  HMAccountsMetadata,
  HMActivitySummary,
  HMBreadcrumb,
  HMComment,
  HMDocumentInfo,
  hmId,
  HMLibraryDocument,
  InteractionSummaryPayload,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Bookmark, Forward, GitFork, Link, MessageSquare, Pencil} from 'lucide-react'
import {useMemo} from 'react'
import {LibraryEntryUpdateSummary} from './activity'
import {Button} from './button'
import {DraftBadge} from './draft-badge'
import {useHighlighter} from './highlight-context'
import {HMIcon} from './hm-icon'
import {Download, Trash} from './icons'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {PrivateBadge} from './private-badge'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export type DocumentListItemData = HMDocumentInfo | (HMLibraryDocument & {breadcrumbs?: HMBreadcrumb[]})

interface DocumentListItemProps {
  item: DocumentListItemData
  accountsMetadata?: HMAccountsMetadata
  breadcrumbs?: HMBreadcrumb[]
  activitySummary?: HMActivitySummary | null
  latestComment?: HMComment | null
  interactionSummary?: InteractionSummaryPayload | null
  draftId?: string
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
  draftId: draftIdProp,
  isRead,
  indent = false,
  onClick,
}: DocumentListItemProps) {
  const id = item.id
  const draftId = draftIdProp

  const metadata = item.metadata
  const visibility = 'visibility' in item ? item.visibility : undefined
  const isPrivate = visibility === 'PRIVATE'
  const itemActivitySummary =
    activitySummary !== undefined ? activitySummary : 'activitySummary' in item ? item.activitySummary : null
  const itemLatestComment =
    latestComment !== undefined ? latestComment : 'latestComment' in item ? item.latestComment : null
  const itemBreadcrumbs = breadcrumbs !== undefined ? breadcrumbs : 'breadcrumbs' in item ? item.breadcrumbs : null
  const computedIsRead = isRead !== undefined ? isRead : !itemActivitySummary?.isUnread

  const route = draftId ? {key: 'draft' as const, id: draftId} : {key: 'document' as const, id}
  const linkProps = useRouteLink(route)

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Stop propagation to prevent parent handlers (like EmbedWrapper) from firing.
    e.stopPropagation()

    if (onClick) {
      onClick(id)
    } else if (linkProps?.onClick) {
      linkProps.onClick(e)
    }
  }

  const highlighter = useHighlighter()
  const actions = useDocumentActions()
  const navigate = useNavigate()

  const summaryId = useMemo(() => hmId(id.uid, {path: id.path}), [id.uid, id.path])
  const interactionSummaryData = useInteractionSummary(summaryId)
  const commentCount = interactionSummary?.comments ?? interactionSummaryData.data?.comments ?? 0

  const bookmarked = actions.isBookmarked?.(id) ?? false
  const isOwner = actions.selectedAccountUid === id.uid
  const isLoggedIn = !!actions.myAccountIds?.length
  const hasPath = !!id.path?.length
  const doc = 'document' in item ? (item as any).document : undefined

  const menuItems = useMemo(() => {
    const items: MenuItemType[] = []
    if (actions.onEditDocument && isOwner) {
      items.push({
        key: 'edit',
        label: draftId ? 'Resume Editing' : 'Edit',
        icon: <Pencil className="size-3.5" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onEditDocument!(id, draftId)
        },
      })
    }
    if (actions.onCopyLink) {
      items.push({
        key: 'copy-link',
        label: 'Copy Link',
        icon: <Link className="size-3.5" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onCopyLink!(id)
        },
      })
    }
    if (actions.onMoveDocument && isOwner && hasPath) {
      items.push({
        key: 'move',
        label: 'Move Document',
        icon: <Forward className="size-3.5" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onMoveDocument!(id)
        },
      })
    }
    if (actions.onBranchDocument && isLoggedIn) {
      items.push({
        key: 'branch',
        label: 'Create Document Branch',
        icon: <GitFork className="size-3.5" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onBranchDocument!(id)
        },
      })
    }
    if (actions.onExportDocument && doc) {
      items.push({
        key: 'export',
        label: 'Export',
        icon: <Download className="size-3.5" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onExportDocument!(doc)
        },
      })
    }
    if (actions.onDeleteDocument && isOwner && hasPath) {
      items.push({
        key: 'delete',
        label: 'Delete Document',
        icon: <Trash className="size-3.5" />,
        variant: 'destructive' as const,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onDeleteDocument!(id)
        },
      })
    }
    return items
  }, [actions, id, doc, draftId, isOwner, isLoggedIn, hasPath])

  const hasActions = !!actions.onBookmarkToggle || commentCount > 0 || menuItems.length > 0

  return (
    <Button
      asChild
      variant="ghost"
      {...highlighter(id)}
      className={cn(
        'group/item h-auto w-full items-center justify-start border-none bg-transparent bg-white px-4 py-2 shadow-sm hover:shadow-md dark:bg-black',
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
            <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
              <SizableText className={cn('truncate text-left font-sans')} weight={computedIsRead ? undefined : 'bold'}>
                {getMetadataName(metadata)}
              </SizableText>
              {!!draftId && <DraftBadge />}
              {isPrivate && <PrivateBadge size="sm" />}
            </div>
            {interactionSummary && interactionSummary.comments > 0 && !hasActions && (
              <DocumentListItemCommentCount count={interactionSummary.comments} />
            )}
            {!itemActivitySummary && 'updateTime' in item && (
              <SizableText size="xs" color="muted" className="font-sans">
                {formattedDate(item.updateTime)}
              </SizableText>
            )}
            {hasActions && (
              <div className="flex items-center gap-1">
                {actions.onBookmarkToggle && (
                  <Tooltip content={bookmarked ? 'Remove from Bookmarks' : 'Add to Bookmarks'}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="no-window-drag"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        actions.onBookmarkToggle!(id)
                      }}
                    >
                      {bookmarked ? <Bookmark className="size-3.5 fill-current" /> : <Bookmark className="size-3.5" />}
                    </Button>
                  </Tooltip>
                )}
                {commentCount > 0 && (
                  <Tooltip content="View discussions">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="no-window-drag flex items-center gap-1"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        navigate({key: 'comments', id})
                      }}
                    >
                      <MessageSquare className="size-3.5" />
                      <SizableText size="xs">{commentCount}</SizableText>
                    </Button>
                  </Tooltip>
                )}
                {menuItems.length > 0 && <OptionsDropdown menuItems={menuItems} align="end" side="bottom" />}
              </div>
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

function DocumentListItemBreadcrumbs({breadcrumbs}: {breadcrumbs: HMBreadcrumb[]}) {
  const displayCrumbs = breadcrumbs.slice(1).filter((crumb) => !!crumb.name)
  if (!displayCrumbs.length) return null
  return (
    <div className="flex gap-1">
      {displayCrumbs.map((breadcrumb, idx) => (
        <>
          <Button
            key={breadcrumb.path}
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
            <SizableText key={`separator-${idx}`} className="text-muted-foreground text-sm">
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
      <MessageSquare className="text-muted-foreground size-3.5" />
      <SizableText className="text-muted-foreground text-[10px]">{count}</SizableText>
    </div>
  )
}
