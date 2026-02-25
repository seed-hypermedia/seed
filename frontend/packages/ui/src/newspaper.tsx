import {
  getDocumentImage,
  HMAccountsMetadata,
  hmId,
  HMResourceFetchResult,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Bookmark, Forward, GitFork, Link, MessageSquare, Pencil} from 'lucide-react'
import {HTMLAttributes, useMemo} from 'react'
import {Button} from './button'
import {DraftBadge} from './draft-badge'
import {useImageUrl} from './get-file-url'
import {useHighlighter} from './highlight-context'
import {Download, Trash} from './icons'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {PrivateBadge} from './private-badge'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function DocumentCard({
  docId,
  entity,
  accountsMetadata,
  navigate: navigateProp = true,
  onMouseEnter,
  onMouseLeave,
  banner = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  docId: UnpackedHypermediaId
  entity: HMResourceFetchResult | null | undefined
  accountsMetadata?: HMAccountsMetadata
  navigate?: boolean
  onMouseEnter?: (id: UnpackedHypermediaId) => void
  onMouseLeave?: (id: UnpackedHypermediaId) => void
  banner?: boolean
}) {
  const highlighter = useHighlighter()
  const linkProps = useRouteLink(docId ? {key: 'document', id: docId} : null)
  const imageUrl = useImageUrl()
  const navigate = useNavigate()
  const actions = useDocumentActions()

  const summaryId = useMemo(() => (docId ? hmId(docId.uid, {path: docId.path}) : null), [docId?.uid, docId?.path])
  const interactionSummary = useInteractionSummary(summaryId)
  const commentCount = interactionSummary.data?.comments ?? 0

  const coverImage = entity?.document ? getDocumentImage(entity?.document) : undefined
  const isPrivate = entity?.document?.visibility === 'PRIVATE'
  const doc = entity?.document

  // Context-driven state
  const draftId = actions.getDraftId?.(docId)
  const bookmarked = actions.isBookmarked?.(docId) ?? false
  const isOwner = actions.selectedAccountUid === docId.uid
  const isLoggedIn = !!actions.myAccountIds?.length
  const hasPath = !!docId.path?.length

  // Self-assemble menu items from context
  const menuItems = useMemo(() => {
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
    if (actions.onCopyLink) {
      items.push({
        key: 'copy-link',
        label: 'Copy Link',
        icon: <Link className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onCopyLink!(docId)
        },
      })
    }
    if (actions.onMoveDocument && isOwner && hasPath) {
      items.push({
        key: 'move',
        label: 'Move Document',
        icon: <Forward className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onMoveDocument!(docId)
        },
      })
    }
    if (actions.onBranchDocument && isLoggedIn) {
      items.push({
        key: 'branch',
        label: 'Create Document Branch',
        icon: <GitFork className="size-4" />,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onBranchDocument!(docId)
        },
      })
    }
    if (actions.onExportDocument && doc) {
      items.push({
        key: 'export',
        label: 'Export',
        icon: <Download className="size-4" />,
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
        icon: <Trash className="size-4" />,
        variant: 'destructive' as const,
        onClick: (e) => {
          e?.stopPropagation()
          actions.onDeleteDocument!(docId)
        },
      })
    }
    return items
  }, [actions, docId, doc, isOwner, isLoggedIn, hasPath])

  const sharedProps = {
    ...highlighter(docId),
    className: cn(
      'hover:bg-accent dark:hover:bg-accent @container flex min-h-[200px] flex-1 overflow-hidden rounded-lg bg-white shadow-md transition-colors duration-300 dark:bg-black',
      banner && 'rounded-xl md:min-h-[240px] lg:min-h-[280px]',
    ),
  }

  const content = (
    <>
      <div className="flex max-w-full flex-1 cursor-pointer flex-col @md:flex-row">
        {coverImage && (
          <div className={cn('relative h-40 w-full shrink-0 @md:h-auto @md:w-1/2', banner && '@md:h-auto')}>
            <img className="absolute top-0 left-0 h-full w-full object-cover" src={imageUrl(coverImage, 'L')} alt="" />
          </div>
        )}
        <div className={cn('flex min-h-0 flex-1 flex-col justify-between')}>
          <div className="p-4">
            <p
              className={cn(
                'text-foreground block font-sans leading-tight! font-bold',
                banner ? 'text-2xl' : 'text-lg',
              )}
            >
              {entity?.document?.metadata?.name}
            </p>
          </div>
          <div className="flex items-center justify-between py-3 pr-2 pl-4">
            <div className="flex items-center gap-1.5">
              {!!draftId && <DraftBadge />}
              {!draftId && isPrivate && <PrivateBadge size="sm" />}
            </div>
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
                    {bookmarked ? <Bookmark className="size-4 fill-current" /> : <Bookmark className="size-4" />}
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
          </div>
        </div>
      </div>
    </>
  )

  if (navigateProp && linkProps) {
    return (
      <a {...sharedProps} {...linkProps} {...(props as any)}>
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
