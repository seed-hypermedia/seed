import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {type DocumentMachineEvent} from '@shm/shared/models/document-machine'
import {useAccount} from '@shm/shared/models/entity'
import {
  selectDocument,
  selectDraftId,
  selectMetadata,
  selectSaveIndicatorStatus,
  useDocumentSelector,
  useDocumentSend,
} from '@shm/shared/models/use-document-machine'
import {useUnpublishedChangeCount} from '@shm/shared/models/use-unpublished-change-count'
import {type AnyTimestamp, formattedDateMedium, formattedDateShort, normalizeDate} from '@shm/shared/utils/date'
import {Check, ChevronRight, Clock, Copy, FileDiff, Trash, UploadCloud} from 'lucide-react'
import React, {forwardRef, useMemo, useRef, useState} from 'react'
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
  /** Path-segment slugifier for the first-publish editable permalink. */
  slugify?: (raw: string) => string
  /** First-publish slug suggestion. */
  computeFirstPublishPath?: (parentPath: string[], title: string, draftId: string) => string[]
  /** Navigate to document versions panel. Row hidden when undefined. */
  onGoToVersions?: (docId: UnpackedHypermediaId) => void
  /**
   * Walks the editor's content for embed blocks pointing at
   * unpublished child drafts.
   */
  getUnpublishedChildCount?: () => number
}

const publishTriggeredForDoc = new Set<string>()

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
  slugify,
  computeFirstPublishPath,
  onGoToVersions,
}: {
  docId: UnpackedHypermediaId
  changeCount: number
  onPublish: (pathOverride?: string[]) => void
  onClose: () => void
  publishDisabled: boolean
  /** When greater than 0, publish is blocked because the doc embeds child drafts that haven't been published yet. */
  unpublishedChildCount?: number
} & EditingToolbarCallbacks) {
  const publishedDoc = useDocumentSelector(selectDocument)
  const draftId = useDocumentSelector(selectDraftId)
  const metadata = useDocumentSelector(selectMetadata)

  const isHomeDoc = (docId.path?.length ?? 0) === 0
  const isFirstPublish = !publishedDoc?.version && !isHomeDoc
  const isPrivate = publishedDoc?.visibility === 'PRIVATE'
  const lastSeg = docId.path?.at(-1) || ''
  const isPlaceholderPath = !!draftId && lastSeg === `-${draftId}`

  const slugFromTitle = useMemo(() => {
    if (!isFirstPublish || !draftId || !isPlaceholderPath || !computeFirstPublishPath) return null
    return computeFirstPublishPath(docId.path ?? [], metadata?.name || '', draftId)
  }, [isFirstPublish, isPlaceholderPath, docId.path, metadata?.name, draftId, computeFirstPublishPath])

  const autoSlugSegment = slugFromTitle?.at(-1) ?? lastSeg
  const lastAutoSlugRef = useRef<string | null>(null)
  const [editedPathSegment, setEditedPathSegment] = useState<string | null>(null)
  const userEditedRef = useRef(false)

  if (autoSlugSegment !== lastAutoSlugRef.current) {
    lastAutoSlugRef.current = autoSlugSegment
    if (!userEditedRef.current) {
      setEditedPathSegment(autoSlugSegment)
    }
  }

  const effectivePathSegment = editedPathSegment ?? autoSlugSegment ?? ''
  const previewPath = useMemo(() => {
    if (!isFirstPublish) return docId.path
    const parent = (docId.path ?? []).slice(0, -1)
    return [...parent, effectivePathSegment || `untitled-${draftId ?? ''}`]
  }, [isFirstPublish, docId.path, effectivePathSegment, draftId])

  const effectiveDocId = isFirstPublish ? {...docId, path: previewPath} : docId
  const documentUrl = getDocumentUrl?.(effectiveDocId) ?? null

  const firstAuthorUid = publishedDoc?.authors?.[0]
  const authorAccount = useAccount(firstAuthorUid)
  const authorName = authorAccount.data?.metadata?.name
  const relativeTime = formatRelativeTime(publishedDoc?.updateTime)
  const absoluteTime = publishedDoc?.updateTime ? formattedDateMedium(publishedDoc.updateTime) : undefined

  return (
    <div className="flex flex-col gap-3">
      {/* URL row */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Your document will be available at</p>
        {documentUrl ? (
          <div className="flex items-center gap-2">
            <span
              className="text-muted-foreground min-w-0 flex-1 text-xs"
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
            <Tooltip content="Copy URL">
              <Button
                size="iconSm"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  copyTextToClipboard(documentUrl).then(() => toast.success('Copied document URL'))
                }}
              >
                <Copy size={14} />
              </Button>
            </Tooltip>
          </div>
        ) : (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Spinner className="size-3" />
            <span>Loading…</span>
          </div>
        )}
        {isFirstPublish && slugify && (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">Edit your permalink</p>
            <Input
              value={`/${effectivePathSegment}`}
              disabled={isPrivate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                if (isPrivate) return
                userEditedRef.current = true
                const raw = e.target.value.replace(/^\//, '')
                setEditedPathSegment(slugify(raw))
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
                  e.stopPropagation()
                  ;(e.target as HTMLInputElement).select()
                }
              }}
              placeholder="/document-path"
              className="h-8 border-black/10 text-xs dark:border-white/20"
            />
            {isPrivate ? (
              <p className="text-muted-foreground text-xs">Private document paths are generated automatically.</p>
            ) : null}
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
            className="hover:bg-muted -mx-2 flex items-center gap-2 rounded px-2 py-1 text-left text-xs"
          >
            <Clock className="text-muted-foreground size-3.5" />
            <span className="flex-1">
              <span className="text-foreground">{relativeTime ?? 'Published'}</span>
              {authorName ? <span className="text-muted-foreground"> by {authorName}</span> : null}
            </span>
            <ChevronRight className="text-muted-foreground size-3.5" />
          </button>
        ) : (
          <div title={absoluteTime} className="-mx-2 flex items-center gap-2 rounded px-2 py-1 text-xs">
            <Clock className="text-muted-foreground size-3.5" />
            <span className="flex-1">
              <span className="text-foreground">{relativeTime ?? 'Published'}</span>
              {authorName ? <span className="text-muted-foreground"> by {authorName}</span> : null}
            </span>
          </div>
        )
      ) : (
        <div className="-mx-2 flex items-center gap-2 rounded px-2 py-1 text-xs">
          <Clock className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground flex-1">Not yet published</span>
        </div>
      )}

      {/* Changes count row */}
      <div className="-mx-2 flex items-center gap-2 rounded px-2 py-1 text-xs">
        <FileDiff className="text-muted-foreground size-3.5" />
        <span className="flex-1">
          {changeCount === 0 ? 'No changes to publish' : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`}
        </span>
      </div>

      {unpublishedChildCount > 0 ? (
        <div className="border-warning bg-warning/10 text-warning-foreground -mx-1 rounded border px-3 py-2 text-xs">
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

      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          variant={publishDisabled ? 'ghost' : 'brand'}
          className={cn(
            publishDisabled &&
              'bg-neutral-100 text-neutral-500 hover:bg-neutral-100 disabled:opacity-100 dark:bg-neutral-800 dark:text-neutral-400',
          )}
          disabled={publishDisabled}
          onClick={() => {
            const override =
              isFirstPublish && !isPrivate && userEditedRef.current && previewPath ? previewPath : undefined
            onPublish(override)
          }}
        >
          Publish: Make it live now
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
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
        <span className="hidden sm:inline">Publish</span>
        <span className="sm:hidden">
          <UploadCloud className="size-4" />
        </span>
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
  slugify,
  computeFirstPublishPath,
  onGoToVersions,
  getUnpublishedChildCount,
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

  const [hasTriggeredPublish, setHasTriggeredPublishState] = useState(() => publishTriggeredForDoc.has(docId.id))
  const setHasTriggeredPublish = () => {
    publishTriggeredForDoc.add(docId.id)
    setHasTriggeredPublishState(true)
  }
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

  const publishNow = (pathOverride?: string[]) => {
    if (!canPublish) return
    popoverState.onOpenChange(false)
    setHasTriggeredPublish()
    send({type: 'edit.start'})
    send({type: 'publish.start', pathOverride})
  }

  const handlePublishTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const livePeekAtClick = getUnpublishedChildCount?.() ?? 0
    if (livePeekAtClick > 0 || !canPublish) {
      popoverState.onOpenChange(true)
      return
    }
    if (hasTriggeredPublish) {
      publishNow()
    } else {
      popoverState.onOpenChange(!popoverState.open)
    }
  }

  return (
    <>
      <Popover open={popoverState.open} onOpenChange={popoverState.onOpenChange}>
        <PopoverAnchor asChild>
          <PublishTrigger canPublish={canPublish} onClick={handlePublishTriggerClick} />
        </PopoverAnchor>
        <PopoverContent align="end" className="w-80">
          <PublishPopoverBody
            docId={docId}
            changeCount={changeCount}
            onPublish={publishNow}
            onClose={() => popoverState.onOpenChange(false)}
            publishDisabled={!canPublish}
            unpublishedChildCount={effectiveUnpublishedChildCount}
            getDocumentUrl={getDocumentUrl}
            slugify={slugify}
            computeFirstPublishPath={computeFirstPublishPath}
            onGoToVersions={onGoToVersions}
          />
        </PopoverContent>
      </Popover>
      <OptionsDropdown menuItems={allItems} align="end" side="bottom" />
    </>
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
