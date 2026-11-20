import {
  HMAccountsMetadata,
  HMActivitySummary,
  HMBreadcrumb,
  HMComment,
  HMDocumentInfo,
  HMLibraryDocument,
  HMQueryBlockItemSummary,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  formattedDate,
  getMetadataName,
  hmId,
  InteractionSummaryPayload,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {canShowMoveDocumentAction, canShowRepublishDocumentAction} from '@shm/shared/utils/document-actions'
import {createWebHMUrl, getVersionHeads, hmIdToURL} from '@shm/shared/utils/entity-id-url'
import {useNavigate} from '@shm/shared/utils/navigation'
import {ChevronRight, Copy, Forward, GitFork, History, MessageSquare, Pencil, Pin} from 'lucide-react'
import {Fragment, useMemo} from 'react'
import {LibraryEntryUpdateSummary} from './activity'
import {Button} from './button'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {createCopyLinkMenuItem, getWebCopyLinkHostname} from './copy-link-menu'
import {FacePile} from './face-pile'
import {DraftBadge} from './draft-badge'
import {useHighlighter} from './highlight-context'
import {HMIcon} from './hm-icon'
import {Download, Trash} from './icons'
import {MergedBadge} from './merged-badge'
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
  interactionSummary?: HMQueryBlockItemSummary | InteractionSummaryPayload | null
  /** Pre-computed contributor UIDs (document authors + comment/mention authors). */
  contributorUids?: string[]
  draftId?: string
  isRead?: boolean
  indent?: boolean
  onClick?: (id: UnpackedHypermediaId) => void
  className?: string
  expandable?: {
    expanded: boolean
    onToggle: () => void
    isLoading?: boolean
  }
  /** Extra menu items rendered in the row options menu. */
  extraMenuItems?: MenuItemType[]
  /** Pin-specific display state. When provided, the row shows pin status badges. */
  pinState?: {
    isPinned?: boolean
    isOutdated?: boolean
    isDeleted?: boolean
  }
}

export function DocumentListItem({
  item,
  className,
  accountsMetadata,
  breadcrumbs,
  activitySummary,
  latestComment,
  contributorUids,
  interactionSummary,
  draftId: draftIdProp,
  isRead,
  indent = false,
  onClick,
  expandable,
  extraMenuItems,
  pinState,
}: DocumentListItemProps) {
  const id = item.id
  const actions = useDocumentActions()
  const draft = actions.getDraft?.(id)
  const draftId = draftIdProp ?? draft?.id

  const metadata = draft?.metadata ? {...item.metadata, ...draft.metadata} : item.metadata
  const visibility = 'visibility' in item ? item.visibility : undefined
  const isPrivate = visibility === 'PRIVATE'
  const headCount = getVersionHeads('version' in item ? item.version : undefined).length
  const itemActivitySummary =
    activitySummary !== undefined ? activitySummary : 'activitySummary' in item ? item.activitySummary : null
  const itemLatestComment =
    latestComment !== undefined ? latestComment : 'latestComment' in item ? item.latestComment : null
  const itemBreadcrumbs = breadcrumbs !== undefined ? breadcrumbs : 'breadcrumbs' in item ? item.breadcrumbs : null
  const computedIsRead = isRead !== undefined ? isRead : !itemActivitySummary?.isUnread

  const route = draftIdProp ? {key: 'draft' as const, id: draftIdProp} : {key: 'document' as const, id}
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
  const {onCopyReference, onPushReference, origin, experiments} = useUniversalAppContext()
  const navigate = useNavigate()

  const summaryId = useMemo(() => hmId(id.uid, {path: id.path}), [id.uid, id.path])
  const interactionSummaryData = useInteractionSummary(summaryId, {enabled: !interactionSummary})
  const commentCount = interactionSummary?.comments ?? interactionSummaryData.data?.comments ?? 0
  const childCount =
    (interactionSummary && 'children' in interactionSummary ? interactionSummary.children : undefined) ??
    interactionSummaryData.data?.children ??
    0
  const canExpand = !!expandable && (childCount > 0 || expandable.expanded || expandable.isLoading)

  const pinned = pinState?.isPinned ?? actions.isPinned?.(id) ?? false
  const itemVersion = 'version' in item ? item.version ?? null : null
  const itemTitle = getMetadataName(metadata)
  const isOwner = actions.selectedAccountUid === id.uid
  const hasPath = !!id.path?.length
  const selectedAccountCanWriteSource = isOwner || !!actions.canWriteDocument?.(id)
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
    if (actions.onDuplicateDocument && isOwner && hasPath) {
      items.push({
        key: 'duplicate',
        label: 'Duplicate Document',
        icon: <Copy className="size-3.5" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onDuplicateDocument!(id)
        },
      })
    }
    if (actions.onCopyLink) {
      const copyCanonical = onCopyReference ? () => onCopyReference(id) : null
      const copyGateway = async () => {
        const gwUrl = getWebCopyLinkHostname(origin)
        const url = createWebHMUrl(id.uid, {
          path: id.path,
          version: id.version,
          latest: id.latest,
          blockRef: id.blockRef,
          blockRange: id.blockRange,
          hostname: gwUrl,
        })
        await copyUrlToClipboardWithFeedback(url, 'Gateway')
        onPushReference?.(id)
      }
      items.push(
        createCopyLinkMenuItem({
          advanced: experiments?.advancedCopyLinkOptions,
          iconClassName: 'size-3.5',
          canonical: {copy: copyCanonical},
          gateway: {copy: copyGateway},
          hypermedia: {
            copy: () => copyUrlToClipboardWithFeedback(hmIdToURL(id), 'Hypermedia'),
          },
        }),
      )
    }
    if (
      actions.onMoveDocument &&
      canShowMoveDocumentAction({
        id,
        selectedAccountUid: actions.selectedAccountUid,
        canWriteSource: selectedAccountCanWriteSource,
      })
    ) {
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
    if (
      actions.onRepublishDocument &&
      canShowRepublishDocumentAction({id, selectedAccountUid: actions.selectedAccountUid})
    ) {
      items.push({
        key: 'republish',
        label: 'Republish',
        icon: <GitFork className="size-3.5" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onRepublishDocument!(id)
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
    if (extraMenuItems) {
      items.push(...extraMenuItems)
    }
    return items
  }, [
    actions.onEditDocument,
    actions.onDuplicateDocument,
    actions.onCopyLink,
    actions.onMoveDocument,
    actions.onRepublishDocument,
    actions.onExportDocument,
    actions.onDeleteDocument,
    id,
    doc,
    draftId,
    isOwner,
    selectedAccountCanWriteSource,
    hasPath,
    onCopyReference,
    onPushReference,
    origin,
    experiments?.advancedCopyLinkOptions,
    extraMenuItems,
  ])

  const canPin = !!actions.pinDocument || !!actions.unpinDocument
  const hasActions = canPin || commentCount > 0 || menuItems.length > 0

  return (
    <Button
      asChild
      variant="ghost"
      {...highlighter(id)}
      className={cn(
        'group/item h-auto w-full items-center justify-start border-none bg-transparent bg-white px-4 py-2 shadow-sm dark:bg-black',
        className,
      )}
    >
      <a data-resourceid={id.id} {...linkProps} onClick={handleClick}>
        {indent && <div className="size-8 shrink-0" />}
        {expandable && (
          <button
            type="button"
            aria-label={expandable.expanded ? 'Collapse children' : 'Expand children'}
            aria-expanded={expandable.expanded}
            disabled={!canExpand}
            className={cn(
              'no-window-drag text-muted-foreground hover:bg-muted/70 -ml-2 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
              !canExpand && 'pointer-events-none invisible',
            )}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              expandable.onToggle()
            }}
          >
            <ChevronRight
              className={cn('size-4 transition-transform duration-150', expandable.expanded && 'rotate-90')}
            />
          </button>
        )}
        <HMIcon size={28} id={id} name={metadata?.name} icon={metadata?.icon} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {itemBreadcrumbs && itemBreadcrumbs.length > 1 && (
            <DocumentListItemBreadcrumbs breadcrumbs={itemBreadcrumbs} />
          )}
          <div className="flex flex-1 items-center gap-3">
            <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
              <SizableText
                className={cn(
                  'truncate text-left font-sans',
                  pinState?.isDeleted && 'text-muted-foreground line-through',
                )}
                weight={computedIsRead ? undefined : 'bold'}
              >
                {getMetadataName(metadata)}
              </SizableText>
              {!!draftId && <DraftBadge />}
              {isPrivate && <PrivateBadge size="sm" />}
              {headCount > 1 && <MergedBadge count={headCount} size="sm" />}
              {pinState?.isOutdated && (
                <Tooltip content="Changed since you pinned it">
                  <History className="size-3.5 text-amber-500" />
                </Tooltip>
              )}
              {pinState?.isDeleted && (
                <Tooltip content="This document has been deleted">
                  <Trash className="text-destructive size-3.5" />
                </Tooltip>
              )}
            </div>
            {commentCount > 0 && !hasActions && <DocumentListItemCommentCount count={commentCount} />}
            {!itemActivitySummary && 'updateTime' in item && (
              <SizableText size="xs" color="muted" className="font-sans">
                {formattedDate(item.updateTime)}
              </SizableText>
            )}
            {hasActions && (
              <div className="flex items-center gap-1">
                {canPin && (
                  <Tooltip content={pinned ? 'Unpin document' : 'Pin document'}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="no-window-drag"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (pinned) {
                          actions.unpinDocument?.(id)
                        } else {
                          actions.pinDocument?.(id, itemTitle, itemVersion)
                        }
                      }}
                    >
                      {<Pin className={cn('size-3.5', pinned && 'fill-current')} />}
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
                      <SizableText size="xs" className="font-sans">
                        {commentCount}
                      </SizableText>
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
          {contributorUids && contributorUids.length > 0 && accountsMetadata && (
            <div className="mt-1">
              <FacePile accounts={contributorUids} accountsMetadata={accountsMetadata} />
            </div>
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
        <Fragment key={breadcrumb.path}>
          <Button
            variant="link"
            className="px-0 text-[10px]"
            size="xs"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            {breadcrumb.name}
          </Button>
          {idx === displayCrumbs.length - 1 ? null : (
            <SizableText className="text-muted-foreground font-sans text-sm">/</SizableText>
          )}
        </Fragment>
      ))}
    </div>
  )
}

function DocumentListItemCommentCount({count}: {count: number}) {
  if (!count) return null
  return (
    <div className="flex items-center gap-1">
      <MessageSquare className="text-muted-foreground size-3.5" />
      <SizableText className="text-muted-foreground font-sans text-[10px]">{count}</SizableText>
    </div>
  )
}
