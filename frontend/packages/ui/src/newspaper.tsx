import type {HMBlockImage} from '@seed-hypermedia/client/hm-types'
import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMQueryBlockItemSummary,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {findFirstBlock, hmId, plainTextOfContent, useRouteLink, useUniversalAppContext} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useResource} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {
  canShowMoveDocumentAction,
  canShowRepublishDocumentAction,
  type DocumentCardActionOrigin,
} from '@shm/shared/utils/document-actions'
import {createWebHMUrl, getVersionHeads, hmIdToURL} from '@shm/shared/utils/entity-id-url'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Bookmark, Copy, FilePen, FileText, Forward, History, Layers, MessageSquare, Pencil, Split} from 'lucide-react'
import {HTMLAttributes, useMemo} from 'react'
import {Button} from './button'
import {createCopyLinkMenuItem} from './copy-link-menu'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {createDocumentVersionsPanelRoute} from './document-versions-panel'
import {DraftBadge} from './draft-badge'
import {FacePile} from './face-pile'
import {useImageUrl} from './get-file-url'
import {useHighlighter} from './highlight-context'
import {Download, Trash} from './icons'
import {MergedBadge} from './merged-badge'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {PrivateBadge} from './private-badge'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Builds the DocumentCard inline menu items */
export function useDocumentCardMenuItems(
  docId: UnpackedHypermediaId,
  doc?: HMResourceFetchResult['document'] | null,
  relocationOrigin?: DocumentCardActionOrigin,
): MenuItemType[] {
  const actions = useDocumentActions()
  const draft = actions.getDraft?.(docId)
  const navigate = useNavigate()
  const {onCopyReference, onPushReference, origin, experiments} = useUniversalAppContext()
  const draftId = actions.getDraftId?.(docId) ?? draft?.id
  const isOwner = actions.selectedAccountUid === docId.uid
  const hasPath = !!docId.path?.length
  const selectedAccountCanWriteSource = isOwner || !!actions.canWriteDocument?.(docId)

  return useMemo(() => {
    const items: MenuItemType[] = []
    if (actions.onEditDocument && isOwner) {
      items.push({
        key: 'edit',
        label: draftId ? 'Resume Editing' : 'Edit',
        icon: <Pencil className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onEditDocument!(docId, draftId)
        },
      })
    }
    items.push({
      key: 'versions',
      label: 'Versions history',
      icon: <History className="size-4" />,
      onClick: (e) => {
        e?.stopPropagation()
        navigate({
          key: 'document',
          id: docId,
          panel: createDocumentVersionsPanelRoute(docId),
        } as any)
      },
    })
    if (isOwner) {
      items.push({
        key: 'options',
        label: 'Document Settings',
        icon: <FilePen className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          navigate({key: 'document', id: docId, panel: {key: 'options'}} as any)
        },
      })
    }
    if (actions.onCopyLink) {
      const copyCanonical = onCopyReference ? () => onCopyReference(docId) : null
      const copyGateway = async () => {
        const gwUrl = origin ?? DEFAULT_GATEWAY_URL
        const url = createWebHMUrl(docId.uid, {
          path: docId.path,
          version: docId.version,
          latest: docId.latest,
          blockRef: docId.blockRef,
          blockRange: docId.blockRange,
          hostname: gwUrl,
        })
        await copyUrlToClipboardWithFeedback(url, 'Gateway')
        onPushReference?.(docId)
      }
      items.push(
        createCopyLinkMenuItem({
          advanced: experiments?.advancedCopyLinkOptions,
          label: 'Copy link',
          canonical: {copy: copyCanonical},
          gateway: {copy: copyGateway},
          hypermedia: {
            copy: () => copyUrlToClipboardWithFeedback(hmIdToURL(docId), 'Hypermedia'),
          },
        }),
      )
    }
    if (
      actions.onMoveDocument &&
      canShowMoveDocumentAction({
        id: docId,
        selectedAccountUid: actions.selectedAccountUid,
        canWriteSource: selectedAccountCanWriteSource,
      })
    ) {
      items.push({
        key: 'move',
        label: 'Move',
        icon: <Forward className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onMoveDocument!(docId, relocationOrigin)
        },
      })
    }
    if (actions.onDuplicateDocument && isOwner && !!docId.path?.length) {
      items.push({
        key: 'duplicate',
        label: 'Duplicate document',
        icon: <Copy className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onDuplicateDocument!(docId)
        },
      })
    }
    if (
      actions.onRepublishDocument &&
      canShowRepublishDocumentAction({id: docId, selectedAccountUid: actions.selectedAccountUid})
    ) {
      items.push({
        key: 'republish',
        label: 'Republish',
        icon: <Split className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onRepublishDocument!(docId, relocationOrigin)
        },
      })
    }
    if (actions.onExportDocument && doc) {
      items.push({
        key: 'export',
        label: 'Export document',
        icon: <Download className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onExportDocument!(doc)
        },
      })
    }
    items.push({
      key: 'directory',
      label: 'Subdocuments',
      icon: <Layers className="size-4" />,
      onClick: (e) => {
        e?.stopPropagation()
        navigate({key: 'directory', id: docId} as any)
      },
    })
    if (actions.onDeleteDocument && isOwner && hasPath) {
      items.push({
        key: 'delete',
        label: 'Delete document',
        icon: <Trash className="size-4" />,
        variant: 'destructive' as const,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onDeleteDocument!(docId)
        },
      })
    }
    return items
  }, [
    actions,
    docId,
    selectedAccountCanWriteSource,
    hasPath,
    doc,
    isOwner,
    navigate,
    onCopyReference,
    onPushReference,
    origin,
    experiments?.advancedCopyLinkOptions,
    draftId,
    relocationOrigin,
  ])
}

export function DocumentCard({
  docId,
  entity,
  metadata,
  visibility,
  version,
  interactionSummary: interactionSummaryProp,
  accountsMetadata,
  contributorUids,
  navigate: navigateProp = true,
  titleLinkOnly = false,
  onMouseEnter,
  onMouseLeave,
  banner = false,
  showSummary = false,
  hideInlineActions = false,
  relocationOrigin,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  docId: UnpackedHypermediaId
  entity: HMResourceFetchResult | null | undefined
  metadata?: HMDocumentInfo['metadata']
  visibility?: HMDocumentInfo['visibility']
  version?: string
  interactionSummary?: HMQueryBlockItemSummary | null
  accountsMetadata?: HMAccountsMetadata
  contributorUids?: string[]
  navigate?: boolean
  titleLinkOnly?: boolean
  onMouseEnter?: (id: UnpackedHypermediaId) => void
  onMouseLeave?: (id: UnpackedHypermediaId) => void
  banner?: boolean
  showSummary?: boolean
  /** Hide the inline bookmark / comments / options-dropdown row */
  hideInlineActions?: boolean
  relocationOrigin?: DocumentCardActionOrigin
}) {
  const highlighter = useHighlighter()
  const linkProps = useRouteLink(docId ? {key: 'document', id: docId} : null)
  const {onClick: routeOnClick, tag: _routeTag, ...linkAttributes} = linkProps
  const imageUrl = useImageUrl()
  const navigate = useNavigate()
  const actions = useDocumentActions()
  const draft = actions.getDraft?.(docId)

  const summaryId = useMemo(() => (docId ? hmId(docId.uid, {path: docId.path}) : null), [docId?.uid, docId?.path])
  const interactionSummary = useInteractionSummary(summaryId, {enabled: !interactionSummaryProp})
  const commentCount = interactionSummaryProp?.comments ?? interactionSummary.data?.comments ?? 0

  const baseMetadata = metadata ?? entity?.document?.metadata
  const resolvedMetadata = draft?.metadata ? {...baseMetadata, ...draft.metadata} : baseMetadata
  const textContent = useMemo(() => {
    if (!showSummary) return null
    if (resolvedMetadata?.summary) {
      return resolvedMetadata.summary
    }
    return plainTextOfContent(entity?.document?.content)
  }, [showSummary, resolvedMetadata, entity?.document?.content])

  const explicitCover = resolvedMetadata?.cover
  const explicitIcon = resolvedMetadata?.icon
  // When the doc has neither a cover nor an explicit icon, fall back to
  // the first image block in the doc's content.
  const needsContentFetch = !explicitCover && !explicitIcon && !entity?.document?.content?.length
  const lazyResource = useResource(needsContentFetch ? docId : null, {
    enabled: needsContentFetch,
  })
  const lazyContent = lazyResource.data?.type === 'document' ? lazyResource.data.document?.content : undefined
  const fallbackContent = entity?.document?.content ?? lazyContent
  const firstContentImage = useMemo(() => {
    if (explicitCover || explicitIcon) return undefined
    if (!fallbackContent?.length) return undefined
    const block = findFirstBlock<HMBlockImage>(
      fallbackContent,
      (b): b is HMBlockImage => b.type === 'Image' && !!(b as any).link,
    )
    return block?.link || undefined
  }, [explicitCover, explicitIcon, fallbackContent])
  const coverImage = explicitCover || firstContentImage
  const iconImage = explicitIcon
  const resolvedVisibility = visibility ?? entity?.document?.visibility
  const isPrivate = resolvedVisibility === 'PRIVATE'
  const doc = entity?.document
  const headCount = getVersionHeads(version ?? doc?.version).length

  // Context-driven state for the inline row (badges, bookmark button).
  const draftId = actions.getDraftId?.(docId) ?? draft?.id
  const bookmarked = actions.isBookmarked?.(docId) ?? false

  const menuItems = useDocumentCardMenuItems(docId, doc, relocationOrigin)

  const sharedProps = {
    ...highlighter(docId),
    className: cn(
      'hover:bg-accent dark:hover:bg-accent @container flex w-full overflow-hidden rounded-lg bg-white shadow-md transition-colors duration-300 dark:bg-black',
      banner && coverImage && 'rounded-xl md:min-h-[240px] lg:min-h-[280px]',
      banner && !coverImage && 'rounded-xl',
    ),
  }
  const titleClassName = cn(
    'text-foreground block font-sans leading-tight! font-bold',
    banner ? 'text-2xl' : 'truncate text-lg',
  )
  const title = resolvedMetadata?.name
  const content = (
    <>
      <div
        className={cn(
          'flex max-w-full min-w-0 flex-1 flex-col @md:flex-row',
          navigateProp && 'cursor-pointer',
          // Stack items vertically in narrow containers like grid items.
          // Wwitch to horizontal once the card has room.
          '@md:items-center',
          coverImage && '@md:items-stretch',
        )}
      >
        {coverImage ? (
          // Cover image. Banner cards keep a half width cover.
          // Regular row cards get a rectanglethat stretches
          // vertically to fill the card's row height.
          <div
            className={cn(
              'relative m-3 h-24 shrink-0 overflow-hidden rounded-md @md:m-3 @md:h-auto',
              banner ? '@md:w-1/2' : '@md:w-32',
            )}
          >
            <img className="absolute top-0 left-0 h-full w-full object-cover" src={imageUrl(coverImage, 'L')} alt="" />
          </div>
        ) : iconImage ? (
          // No cover, but the doc has an icon — render it as a square
          // thumbnail aligned top-left next to the title.
          <div className="bg-muted m-3 flex aspect-square size-12 shrink-0 items-center justify-center overflow-hidden rounded-md @md:size-14">
            <img src={imageUrl(iconImage, 'S')} alt="" className="size-full object-cover" />
          </div>
        ) : (
          // Neither cover nor icon — green doc-icon placeholder.
          <div className="m-3 flex aspect-square size-12 shrink-0 items-center justify-center rounded-md bg-emerald-100 @md:size-14 dark:bg-emerald-900/30">
            <FileText className="size-6 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
          </div>
        )}
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col justify-between')}>
          <div className="p-3">
            {titleLinkOnly && linkAttributes.href ? (
              <a
                {...linkAttributes}
                onMouseDown={(e) => {
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  routeOnClick?.(e)
                }}
                className={cn(titleClassName, 'inline-block max-w-full cursor-pointer no-underline hover:underline')}
              >
                {title}
              </a>
            ) : (
              <p className={titleClassName}>{title}</p>
            )}
            {textContent && (
              <p className={cn('text-muted-foreground mt-2 line-clamp-2 font-sans', !banner && 'text-sm')}>
                {textContent}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between py-2 pr-2 pl-3">
            <div className="flex items-center gap-1.5">
              {contributorUids && contributorUids.length > 0 && accountsMetadata && (
                <FacePile accounts={contributorUids} accountsMetadata={accountsMetadata} />
              )}
              {!!draftId && <DraftBadge />}
              {!draftId && isPrivate && <PrivateBadge size="sm" />}
              {!draftId && headCount > 1 && <MergedBadge count={headCount} size="sm" />}
            </div>
            {!hideInlineActions && (
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
                        actions.onBookmarkToggle!(docId)
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
                        navigate({key: 'comments', id: docId})
                      }}
                    >
                      <MessageSquare className="size-3" />
                      <SizableText size="xs">{commentCount}</SizableText>
                    </Button>
                  </Tooltip>
                )}
                {menuItems.length > 0 && <OptionsDropdown menuItems={menuItems} align="end" side="top" />}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )

  if (navigateProp && linkProps) {
    return (
      <a {...sharedProps} {...linkAttributes} onClick={routeOnClick} {...(props as any)}>
        {content}
      </a>
    )
  }

  return (
    <div {...sharedProps} {...props}>
      {content}
    </div>
  )
}
