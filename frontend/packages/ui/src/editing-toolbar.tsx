import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {type DocumentMachineEvent} from '@shm/shared/models/document-machine'
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
import {Check, ChevronRight, Clock, Copy, FileDiff, Trash} from 'lucide-react'
import React, {forwardRef, ReactNode, useMemo, useRef, useState} from 'react'

/** Platform callbacks injected by the host (desktop or web). */
export type EditingToolbarCallbacks = {
  /** Resolve the public URL where this doc is/will be available. */
  getDocumentUrl?: (docId: UnpackedHypermediaId) => string | null
  /** Open a preview window for the draft. Button hidden when undefined. */
  onOpenPreview?: (draftId: string | null, docId: UnpackedHypermediaId) => void
  /** Confirm + perform discard. Desktop opens delete-draft dialog; web shows a simple confirm. */
  onDiscardConfirm?: (draftId: string, send: (e: DocumentMachineEvent) => void) => void
  /** Path-segment slugifier for the first-publish editable permalink. */
  slugify?: (raw: string) => string
  /** First-publish slug suggestion. */
  computeFirstPublishPath?: (parentPath: string[], title: string, draftId: string) => string[]
  /** Navigate to document versions panel. Row hidden when undefined. */
  onGoToVersions?: (docId: UnpackedHypermediaId) => void
}

const publishTriggeredForDoc = new Set<string>()

/** Dark pill shown top-right while autosave is saving or just saved. */
export function SaveIndicator() {
  const status = useDocumentSelector(selectSaveIndicatorStatus)

  if (status === 'hidden') return null

  const label = status === 'saving' ? 'Saving…' : 'Saved'
  const icon = status === 'saving' ? <Spinner className="size-3" /> : <Check className="size-3" />

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1 text-white dark:bg-neutral-700">
      {icon}
      <span className="text-xs">{label}</span>
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
  getDocumentUrl,
  onOpenPreview,
  slugify,
  computeFirstPublishPath,
  onGoToVersions,
}: {
  docId: UnpackedHypermediaId
  changeCount: number
  onPublish: (pathOverride?: string[]) => void
  onClose: () => void
  publishDisabled: boolean
} & EditingToolbarCallbacks) {
  const publishedDoc = useDocumentSelector(selectDocument)
  const draftId = useDocumentSelector(selectDraftId)
  const metadata = useDocumentSelector(selectMetadata)

  const isHomeDoc = (docId.path?.length ?? 0) === 0
  const isFirstPublish = !publishedDoc?.version && !isHomeDoc
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
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
          </div>
        )}
      </div>

      <Separator className="bg-black/10 dark:bg-white/10" />

      {/* Last published row — clickable only when onGoToVersions provided */}
      {publishedDoc && relativeTime ? (
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
              <span className="text-foreground">{relativeTime}</span>
              {authorName ? <span className="text-muted-foreground"> by {authorName}</span> : null}
            </span>
            <ChevronRight className="text-muted-foreground size-3.5" />
          </button>
        ) : (
          <div title={absoluteTime} className="-mx-2 flex items-center gap-2 rounded px-2 py-1 text-xs">
            <Clock className="text-muted-foreground size-3.5" />
            <span className="flex-1">
              <span className="text-foreground">{relativeTime}</span>
              {authorName ? <span className="text-muted-foreground"> by {authorName}</span> : null}
            </span>
          </div>
        )
      ) : null}

      {/* Changes count row */}
      <div className="-mx-2 flex items-center gap-2 rounded px-2 py-1 text-xs">
        <FileDiff className="text-muted-foreground size-3.5" />
        <span className="flex-1">
          {changeCount === 0 ? 'No changes to publish' : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`}
        </span>
      </div>

      <Separator className="bg-black/10 dark:bg-white/10" />

      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          variant="brand"
          disabled={publishDisabled}
          onClick={() => {
            const override = isFirstPublish && userEditedRef.current && previewPath ? previewPath : undefined
            console.log('[Publish] popover Publish button clicked', {
              docId: docId.id,
              draftId,
              changeCount,
              publishDisabled,
              isFirstPublish,
              override,
            })
            onPublish(override)
          }}
        >
          Publish: Make it live now
        </Button>
        {onOpenPreview && (
          <Button
            size="sm"
            variant="outline"
            className="border-brand text-brand hover:text-brand dark:border-brand"
            onClick={() => {
              onClose()
              onOpenPreview(draftId, docId)
            }}
          >
            Preview: View before publishing
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Trigger button for the Publish popover. Shows a pulsing white dot when there are unsaved changes. */
const PublishTrigger = forwardRef<
  HTMLButtonElement,
  {hasUnsavedChanges: boolean; onClick: (e: React.MouseEvent) => void}
>(({hasUnsavedChanges, onClick}, ref) => {
  return (
    <Button ref={ref} size="sm" variant="brand" className="gap-1.5" onClick={onClick}>
      {hasUnsavedChanges ? (
        <span className="relative flex size-2 shrink-0 rounded-full bg-white">
          <span className="absolute inset-0 animate-ping rounded-full bg-white opacity-75" />
        </span>
      ) : null}
      Publish
    </Button>
  )
})
PublishTrigger.displayName = 'PublishTrigger'

/**
 * Publish button + popover + options dropdown.
 * Must be rendered inside DocumentMachineProvider.
 */
export function PublishButtonWithPopover({
  docId,
  existingMenuItems,
  getDocumentUrl,
  onOpenPreview,
  onDiscardConfirm,
  slugify,
  computeFirstPublishPath,
  onGoToVersions,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
} & EditingToolbarCallbacks) {
  const draftId = useDocumentSelector(selectDraftId)
  const changeCount = useUnpublishedChangeCount()
  const hasUnpublishedChanges = changeCount > 0
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
    console.log('[Publish] publishNow called', {docId: docId.id, draftId, changeCount, pathOverride})
    popoverState.onOpenChange(false)
    setHasTriggeredPublish()
    send({type: 'edit.start'})
    send({type: 'publish.start', pathOverride})
  }

  const handlePublishTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault()
    console.log('[Publish] trigger click', {docId: docId.id, hasTriggeredPublish, draftId, changeCount})
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
          <PublishTrigger hasUnsavedChanges={hasUnpublishedChanges} onClick={handlePublishTriggerClick} />
        </PopoverAnchor>
        <PopoverContent align="end" className="w-80">
          <PublishPopoverBody
            docId={docId}
            changeCount={changeCount}
            onPublish={publishNow}
            onClose={() => popoverState.onOpenChange(false)}
            // Allow clicking Publish during editing.draft.changed (no draftId yet) —
            // the machine queues the publish and flushes it once writeDraft completes.
            // See documentMachine `pendingPublish` flag (Phase 2).
            publishDisabled={changeCount === 0}
            getDocumentUrl={getDocumentUrl}
            onOpenPreview={onOpenPreview}
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
  newButton,
  ...callbacks
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  newButton?: ReactNode
} & EditingToolbarCallbacks) {
  return (
    <div className="flex items-center gap-1">
      <SaveIndicator />
      <PublishButtonWithPopover docId={docId} existingMenuItems={existingMenuItems} {...callbacks} />
      {newButton}
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
  ...callbacks
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
} & EditingToolbarCallbacks) {
  return (
    <div className="flex items-center gap-1">
      <PublishButtonWithPopover docId={docId} existingMenuItems={existingMenuItems} {...callbacks} />
    </div>
  )
}
