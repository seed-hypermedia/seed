import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useIsHomeDraftOverride} from '@shm/shared/home-draft-context'
import {type DocumentMachineEvent} from '@shm/shared/models/document-machine'
import {useAccount} from '@shm/shared/models/entity'
import {
  selectDocument,
  selectDraftId,
  selectEffectivePublishPath,
  selectMetadata,
  selectPublishPath,
  selectRenameError,
  selectRenameState,
  selectSaveIndicatorStatus,
  useDocumentSelector,
  useDocumentSend,
} from '@shm/shared/models/use-document-machine'
import {useUnpublishedChangeCount} from '@shm/shared/models/use-unpublished-change-count'
import {type AnyTimestamp, formattedDateMedium, formattedDateShort, normalizeDate} from '@shm/shared/utils/date'
import {pathNameify} from '@shm/shared/utils/path'
import {Check, ChevronRight, Clock, Copy, FileDiff, Pencil, Trash, X} from 'lucide-react'
import React, {forwardRef, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Popover, PopoverAnchor, PopoverContent} from './components/popover'
import {copyTextToClipboard} from './copy-to-clipboard'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {Separator} from './separator'
import {Spinner} from './spinner'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {usePopoverState} from './use-popover-state'
import {cn} from './utils'

/** Platform callbacks injected by the host (desktop or web). */
export type EditingToolbarCallbacks = {
  /** Resolve the public URL where this doc is/will be available. */
  getDocumentUrl?: (docId: UnpackedHypermediaId) => string | null
  /** Confirm + perform discard. Desktop opens delete-draft dialog; web shows a simple confirm. */
  onDiscardConfirm?: (draftId: string, send: (e: DocumentMachineEvent) => void) => void
  /** Navigate to document versions panel. Row hidden when undefined. */
  onGoToVersions?: (docId: UnpackedHypermediaId) => void
  /**
   * Walks the editor's content for embed blocks pointing at
   * unpublished child drafts.
   */
  getUnpublishedChildCount?: () => number
  /**
   * Intercept the publish action before it reaches the document machine. Return
   * true when handled to skip the normal publish. Return false/undefined
   * to publish normally.
   */
  onPublishIntercept?: (pathOverride?: string[]) => boolean
}

/** Dark pill shown top-right while autosave is saving or just saved. */
export function SaveIndicator() {
  const status = useDocumentSelector(selectSaveIndicatorStatus)

  if (status === 'hidden') return null

  const label = status === 'saving' ? 'Saving…' : 'Saved'
  const icon = status === 'saving' ? <Spinner className="size-3" /> : <Check className="size-3" />

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-2 py-1 text-white sm:px-3 dark:bg-neutral-700">
      {icon}
      <span className="hidden text-xs sm:inline">{label}</span>
    </div>
  )
}

function formatRelativeTime(updateTime: AnyTimestamp): string | null {
  const date = normalizeDate(updateTime)
  if (!date) return null
  const diffSeconds = (Date.now() - date.getTime()) / 1000
  if (diffSeconds < 60) return 'just now'
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
  if (diffSeconds < 86400 * 7) return `${Math.floor(diffSeconds / 86400)}d ago`
  return formattedDateShort(date)
}

/**
 * Popover body shown when the user clicks Publish.
 * Exported for testing.
 */
export function PublishPopoverBody({
  docId,
  changeCount,
  onPublish,
  onClose,
  publishDisabled,
  unpublishedChildCount = 0,
  getDocumentUrl,
  onGoToVersions,
}: {
  docId: UnpackedHypermediaId
  changeCount: number
  onPublish: () => void
  onClose: () => void
  publishDisabled: boolean
  /** When greater than 0, publish is blocked because the doc embeds child drafts that haven't been published yet. */
  unpublishedChildCount?: number
} & EditingToolbarCallbacks) {
  const publishedDoc = useDocumentSelector(selectDocument)
  const metadata = useDocumentSelector(selectMetadata)
  const renameState = useDocumentSelector(selectRenameState)
  const renameError = useDocumentSelector(selectRenameError)
  const persistedPublishPath = useDocumentSelector(selectPublishPath)
  const effectivePath = useDocumentSelector(selectEffectivePublishPath)
  const send = useDocumentSend()

  const homeDraftOverride = useIsHomeDraftOverride()
  const isHomeDoc = homeDraftOverride ?? (docId.path?.length ?? 0) === 0
  const isFirstPublish = !publishedDoc?.version && !isHomeDoc
  const isPrivate = publishedDoc?.visibility === 'PRIVATE'

  const [renameSegment, setRenameSegment] = useState<string | null>(null)

  const renameActive = renameState === 'renaming' || renameState === 'committing' || renameState === 'error'
  const committing = renameState === 'committing'

  const startRename = () => {
    if (isFirstPublish) {
      const persisted = persistedPublishPath?.at(-1)
      setRenameSegment(persisted ? persisted : pathNameify(metadata?.name || ''))
    } else {
      setRenameSegment(docId.path?.at(-1) ?? '')
    }
    send({type: 'rename.start'})
  }

  const cancelRename = () => {
    setRenameSegment(null)
    send({type: 'rename.cancel'})
  }

  const buildPath = () => {
    const slug = pathNameify((renameSegment ?? '').trim())
    const parent = (effectivePath ?? []).slice(0, -1)
    return {slug, path: [...parent, slug]}
  }

  const commitRename = () => {
    const {path} = buildPath()
    send({type: 'rename.commit', path})
  }

  const retryRename = () => {
    const {path} = buildPath()
    send({type: 'rename.retry', path})
  }

  const currentSlug = pathNameify((renameSegment ?? '').trim())
  const unchanged = !isFirstPublish && currentSlug === (docId.path?.at(-1) ?? '')
  const canCommitRename = !committing && currentSlug.length > 0 && !unchanged

  const effectiveDocId = {...docId, path: effectivePath}
  const documentUrl = getDocumentUrl?.(effectiveDocId) ?? null
  const canRename = !isHomeDoc && !isPrivate

  const firstAuthorUid = publishedDoc?.authors?.[0]
  const authorAccount = useAccount(firstAuthorUid)
  const authorName = authorAccount.data?.metadata?.name
  const relativeTime = formatRelativeTime(publishedDoc?.updateTime)
  const absoluteTime = publishedDoc?.updateTime ? formattedDateMedium(publishedDoc.updateTime) : undefined

  return (
    <div className="flex flex-col gap-5">
      {/* URL row */}
      <div className="flex flex-col gap-3">
        <p className="text-base font-medium">Your document will be available at</p>
        {renameActive ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={renameSegment ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameSegment(e.target.value)}
                onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.select()}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && canCommitRename) {
                    commitRename()
                  } else if (e.key === 'Escape') {
                    cancelRename()
                  } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
                    e.stopPropagation()
                    ;(e.target as HTMLInputElement).select()
                  }
                }}
                placeholder="document-path"
                className="h-10 border-black/10 text-sm dark:border-white/20"
              />
              <Tooltip content="Save">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Save path"
                  className="shrink-0"
                  disabled={!canCommitRename}
                  onClick={commitRename}
                >
                  {committing ? <Spinner className="size-4" /> : <Check size={18} />}
                </Button>
              </Tooltip>
              <Tooltip content="Cancel">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Cancel path edit"
                  className="shrink-0"
                  onClick={cancelRename}
                >
                  <X size={18} />
                </Button>
              </Tooltip>
            </div>
            {renameState === 'error' ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-destructive text-sm">{renameError ?? 'Failed to rename'}</p>
                <Button size="sm" variant="ghost" aria-label="Retry rename" onClick={retryRename}>
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        ) : documentUrl ? (
          <div className="flex items-center gap-3">
            <span
              className="text-muted-foreground min-w-0 flex-1 text-sm"
              style={{
                direction: 'rtl',
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {documentUrl}
            </span>
            {canRename ? (
              <Tooltip content="Edit path">
                <Button size="icon" variant="ghost" aria-label="Edit path" className="shrink-0" onClick={startRename}>
                  <Pencil size={18} />
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip content="Copy URL">
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  copyTextToClipboard(documentUrl).then(() => toast.success('Copied document URL'))
                }}
              >
                <Copy size={18} />
              </Button>
            </Tooltip>
          </div>
        ) : (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner className="size-4" />
            <span>Loading…</span>
          </div>
        )}
      </div>

      <Separator className="bg-black/10 dark:bg-white/10" />

      {/* Last published row — clickable only when onGoToVersions provided */}
      {!!publishedDoc?.version ? (
        onGoToVersions ? (
          <button
            type="button"
            onClick={() => {
              onClose()
              onGoToVersions(docId)
            }}
            title={absoluteTime}
            className="hover:bg-muted -mx-3 flex items-center gap-3 rounded px-3 py-2.5 text-left text-sm"
          >
            <Clock className="text-muted-foreground size-5" />
            <span className="flex-1">
              <span className="text-foreground">{relativeTime ?? 'Published'}</span>
              {authorName ? <span className="text-muted-foreground"> by {authorName}</span> : null}
            </span>
            <ChevronRight className="text-muted-foreground size-5" />
          </button>
        ) : (
          <div title={absoluteTime} className="-mx-3 flex items-center gap-3 rounded px-3 py-2.5 text-sm">
            <Clock className="text-muted-foreground size-5" />
            <span className="flex-1">
              <span className="text-foreground">{relativeTime ?? 'Published'}</span>
              {authorName ? <span className="text-muted-foreground"> by {authorName}</span> : null}
            </span>
          </div>
        )
      ) : (
        <div className="-mx-3 flex items-center gap-3 rounded px-3 py-2.5 text-sm">
          <Clock className="text-muted-foreground size-5" />
          <span className="text-muted-foreground flex-1">Not yet published</span>
        </div>
      )}

      {/* Changes count row */}
      <div className="-mx-3 flex items-center gap-3 rounded px-3 py-2.5 text-sm">
        <FileDiff className="text-muted-foreground size-5" />
        <span className="flex-1">
          {changeCount === 0 ? 'No changes to publish' : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`}
        </span>
      </div>

      {unpublishedChildCount > 0 ? (
        <div className="border-warning bg-warning/10 text-warning-foreground -mx-2 rounded-md border px-4 py-3 text-sm">
          <p className="font-medium">
            {unpublishedChildCount === 1
              ? 'This document embeds an unpublished draft.'
              : `This document embeds ${unpublishedChildCount} unpublished drafts.`}
          </p>
          <p className="text-muted-foreground mt-1">
            Publish {unpublishedChildCount === 1 ? 'it' : 'them'} first before publishing this document.
          </p>
        </div>
      ) : null}

      <Separator className="bg-black/10 dark:bg-white/10" />

      <div className="flex flex-col gap-2 pt-1">
        <Button
          size="default"
          variant={publishDisabled ? 'ghost' : 'brand'}
          className={cn(
            'h-11 text-base font-semibold',
            publishDisabled &&
              'bg-neutral-100 text-neutral-500 hover:bg-neutral-100 disabled:opacity-100 dark:bg-neutral-800 dark:text-neutral-400',
          )}
          disabled={publishDisabled}
          onClick={() => onPublish()}
        >
          Publish: Make it live now
        </Button>
        <Button size="default" variant="ghost" className="h-10 text-base" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function canPublishDocument({
  changeCount,
  unpublishedChildCount,
}: {
  changeCount: number
  unpublishedChildCount: number
}) {
  return changeCount > 0 && unpublishedChildCount === 0
}

/** Trigger button for the Publish popover. */
const PublishTrigger = forwardRef<HTMLButtonElement, {canPublish: boolean; onClick: (e: React.MouseEvent) => void}>(
  ({canPublish, onClick}, ref) => {
    return (
      <Button
        ref={ref}
        size="sm"
        variant={canPublish ? 'green' : 'ghost'}
        className={cn(
          'gap-1.5',
          !canPublish &&
            'bg-neutral-100 text-neutral-500 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-400',
        )}
        onClick={onClick}
      >
        <span>Publish</span>
      </Button>
    )
  },
)
PublishTrigger.displayName = 'PublishTrigger'

/**
 * Publish button + popover + options dropdown.
 * Must be rendered inside DocumentMachineProvider.
 */
export function PublishButtonWithPopover({
  docId,
  existingMenuItems,
  unpublishedChildCount = 0,
  getDocumentUrl,
  onDiscardConfirm,
  onGoToVersions,
  getUnpublishedChildCount,
  onPublishIntercept,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  /** When greater than 0, publish is blocked because the doc embeds child drafts that haven't been published yet. */
  unpublishedChildCount?: number
} & EditingToolbarCallbacks) {
  const draftId = useDocumentSelector(selectDraftId)
  const changeCount = useUnpublishedChangeCount()
  const effectiveUnpublishedChildCount = Math.max(unpublishedChildCount, getUnpublishedChildCount?.() ?? 0)
  const canPublish = canPublishDocument({
    changeCount,
    unpublishedChildCount: effectiveUnpublishedChildCount,
  })
  const send = useDocumentSend()

  const popoverState = usePopoverState()

  const editingTrailingItems: MenuItemType[] = []

  if (draftId) {
    editingTrailingItems.push({
      key: 'discard-changes',
      label: 'Discard Changes',
      icon: <Trash className="size-4" />,
      variant: 'destructive' as const,
      onClick: () => {
        if (onDiscardConfirm) {
          onDiscardConfirm(draftId, send)
        } else {
          send({type: 'edit.discard'})
        }
      },
    })
  }

  const allItems = [...existingMenuItems, ...editingTrailingItems]

  const publishNow = () => {
    if (!canPublish) return
    popoverState.onOpenChange(false)
    // Signed-out drafts hand off to account creation instead of publishing directly.
    if (onPublishIntercept?.()) return
    send({type: 'edit.start'})
    send({type: 'publish.start'})
  }

  const handlePublishTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const livePeekAtClick = getUnpublishedChildCount?.() ?? 0
    if (livePeekAtClick > 0 || !canPublish) {
      popoverState.onOpenChange(true)
      return
    }
    popoverState.onOpenChange(!popoverState.open)
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={popoverState.open} onOpenChange={popoverState.onOpenChange}>
        <PopoverAnchor asChild>
          <PublishTrigger canPublish={canPublish} onClick={handlePublishTriggerClick} />
        </PopoverAnchor>
        <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] p-6">
          <PublishPopoverBody
            docId={docId}
            changeCount={changeCount}
            onPublish={publishNow}
            onClose={() => popoverState.onOpenChange(false)}
            publishDisabled={!canPublish}
            unpublishedChildCount={effectiveUnpublishedChildCount}
            getDocumentUrl={getDocumentUrl}
            onGoToVersions={onGoToVersions}
          />
        </PopoverContent>
      </Popover>
      <OptionsDropdown menuItems={allItems} align="end" side="bottom" />
    </div>
  )
}

/**
 * Combined right-actions for DocumentTools when editing.
 * Must be rendered inside DocumentMachineProvider.
 */
export function EditingDocToolsRight({
  docId,
  existingMenuItems,
  unpublishedChildCount,
  ...callbacks
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  unpublishedChildCount?: number
} & EditingToolbarCallbacks) {
  return (
    <div className="relative flex items-center gap-1">
      <div className="pointer-events-none absolute right-full mr-2">
        <SaveIndicator />
      </div>
      <PublishButtonWithPopover
        docId={docId}
        existingMenuItems={existingMenuItems}
        unpublishedChildCount={unpublishedChildCount}
        {...callbacks}
      />
    </div>
  )
}

/**
 * Slim toolbar shown when a draft exists but not actively editing.
 * Must be rendered inside DocumentMachineProvider.
 */
export function DraftActionsToolbar({
  docId,
  existingMenuItems,
  unpublishedChildCount,
  ...callbacks
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  unpublishedChildCount?: number
} & EditingToolbarCallbacks) {
  return (
    <div className="flex items-center gap-1">
      <PublishButtonWithPopover
        docId={docId}
        existingMenuItems={existingMenuItems}
        unpublishedChildCount={unpublishedChildCount}
        {...callbacks}
      />
    </div>
  )
}
