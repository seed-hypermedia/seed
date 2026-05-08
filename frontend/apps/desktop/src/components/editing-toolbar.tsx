import {useGatewayUrl} from '@/models/gateway-settings'
import {client} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {computeInlineDraftPublishPath} from '@/utils/publish-utils'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useUnpublishedChangeCount} from '@shm/shared/models/use-unpublished-change-count'
import {
  selectDocument,
  selectDraftId,
  selectMetadata,
  selectSaveIndicatorStatus,
  useDocumentSelector,
  useDocumentSend,
} from '@shm/shared/models/use-document-machine'
import {type AnyTimestamp, formattedDateMedium, formattedDateShort, normalizeDate} from '@shm/shared/utils/date'
import {createSiteUrl, createWebHMUrl, hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Popover, PopoverAnchor, PopoverContent} from '@shm/ui/components/popover'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {Check, ChevronRight, Clock, Copy, FileDiff, Trash} from 'lucide-react'
import {forwardRef, ReactNode, useMemo, useRef, useState} from 'react'
import {useDeleteDraftDialog} from './delete-draft-dialog'

// Tracks whether the user has already opened the publish popover and triggered a
// publish for a given document in this app session. Survives component remounts.
// Keyed by `docId.id` so switching documents shows the popover on first click for each.
const publishTriggeredForDoc = new Set<string>()

/** Dark pill shown top-right while autosave is saving or just saved. */
function SaveIndicator() {
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

/** Format time/date to show in the last document activity in publish popover */
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

/** The public URL where this document is or will be available. */
function useDocumentUrl(docId: UnpackedHypermediaId): string | null {
  const gatewayUrl = useGatewayUrl()
  // Site home doc for this account. Its metadata may carry a configured siteUrl.
  const siteHomeResource = useResource(hmId(docId.uid))
  const siteUrl =
    siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document?.metadata?.siteUrl : undefined

  return useMemo(() => {
    if (!gatewayUrl.data) return null
    if (siteUrl) {
      return createSiteUrl({path: docId.path, hostname: siteUrl})
    }
    return createWebHMUrl(docId.uid, {path: docId.path, hostname: gatewayUrl.data})
  }, [docId.uid, docId.path, gatewayUrl.data, siteUrl])
}

/**
 * Popover body shown when the user clicks Publish before the first successful publish.
 * Exported for testing.
 */
export function PublishPopoverBody({
  docId,
  changeCount,
  onPublish,
  onClose,
  publishDisabled,
}: {
  docId: UnpackedHypermediaId
  changeCount: number
  onPublish: (pathOverride?: string[]) => void
  onClose: () => void
  publishDisabled: boolean
}) {
  const publishedDoc = useDocumentSelector(selectDocument)
  const draftId = useDocumentSelector(selectDraftId)
  const metadata = useDocumentSelector(selectMetadata)
  const navigate = useNavigate('replace')

  // First-publish detection: no published version exists yet at this route.
  // Editable permalink is hidden for the site root (empty path) since the
  // home doc has no slug to edit.
  const isHomeDoc = (docId.path?.length ?? 0) === 0
  const isFirstPublish = !publishedDoc?.version && !isHomeDoc
  const lastSeg = docId.path?.at(-1) || ''
  // Treat the last segment as a placeholder when it's the inline-draft
  // pattern (`-${draftId}`) — in that case we auto-fill from the title slug.
  // Otherwise default to the existing slug so re-edits don't lose the user's
  // chosen path on first publish.
  const isPlaceholderPath = !!draftId && lastSeg === `-${draftId}`

  const slugFromTitle = useMemo(() => {
    if (!isFirstPublish || !draftId || !isPlaceholderPath) return null
    return computeInlineDraftPublishPath(docId.path ?? [], metadata?.name || '', draftId)
  }, [isFirstPublish, isPlaceholderPath, docId.path, metadata?.name, draftId])

  // Tracks the latest auto-derived slug we wrote into local state. When the
  // title changes and the user hasn't manually edited the input, refresh the
  // input from the new slug; once the user types, we stop syncing.
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

  const documentUrl = useDocumentUrl(isFirstPublish ? {...docId, path: previewPath} : docId)

  const firstAuthorUid = publishedDoc?.authors?.[0]
  const authorAccount = useAccount(firstAuthorUid)
  const authorName = authorAccount.data?.metadata?.name
  const relativeTime = formatRelativeTime(publishedDoc?.updateTime)
  const absoluteTime = publishedDoc?.updateTime ? formattedDateMedium(publishedDoc.updateTime) : undefined

  const goToVersions = () => {
    onClose()
    navigate({
      key: 'document',
      id: docId,
      panel: {key: 'activity', id: docId, filterEventType: ['Ref']},
    } as any)
  }

  const openPreview = () => {
    onClose()
    // Preview the draft when one exists. Fall back to the
    // published doc otherwise.
    const previewRoute = draftId ? {key: 'preview' as const, draftId} : {key: 'preview' as const, docId}
    client.createAppWindow.mutate({
      routes: [previewRoute],
      sidebarLocked: false,
      sidebarWidth: 0,
      accessoryWidth: 0,
    })
  }

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
        {/* Editable permalink — shown on first publish (no published version yet). */}
        {isFirstPublish && (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">Edit your permalink</p>
            <Input
              value={`/${effectivePathSegment}`}
              onChange={(e) => {
                userEditedRef.current = true
                const raw = e.target.value.replace(/^\//, '')
                setEditedPathSegment(pathNameify(raw))
              }}
              onKeyDown={(e) => {
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

      {/* Last published row that opens versions panel on click */}
      {!!publishedDoc?.version ? (
        <button
          type="button"
          onClick={goToVersions}
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
            // Only forward an explicit override when the user typed something
            // different from the auto-derived slug; otherwise let
            // `usePublishResource` apply the rename from the freshest disk
            // metadata.
            const override = isFirstPublish && userEditedRef.current && previewPath ? previewPath : undefined
            onPublish(override)
          }}
        >
          Publish: Make it live now
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-brand text-brand hover:text-brand dark:border-brand"
          onClick={openPreview}
        >
          Preview: View before publishing
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function canPublishDocument({draftId, changeCount}: {draftId: string | null; changeCount: number}) {
  return !!draftId && changeCount > 0
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
        Publish
      </Button>
    )
  },
)
PublishTrigger.displayName = 'PublishTrigger'

/**
 * Shared publish button + popover + options dropdown, used in both editing and
 * non-editing toolbars. Manages the first-click-popover / second-click-publish
 * flow internally.
 * Must be rendered inside DocumentMachineProvider.
 */
export function PublishButtonWithPopover({
  docId,
  existingMenuItems,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
}) {
  const draftId = useDocumentSelector(selectDraftId)
  const changeCount = useUnpublishedChangeCount()
  const canPublish = canPublishDocument({
    draftId,
    changeCount,
  })
  const send = useDocumentSend()
  const deleteDraftDialog = useDeleteDraftDialog()

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
        deleteDraftDialog.open({
          draftId,
          onSuccess: () => send({type: 'edit.discard'}),
        })
      },
    })
  }

  const allItems = [...existingMenuItems, ...editingTrailingItems]

  const publishNow = (pathOverride?: string[]) => {
    if (!canPublish) return
    popoverState.onOpenChange(false)
    setHasTriggeredPublish()
    // From non-editing state (e.g. DraftActionsToolbar), enter editing before
    // publishing so the machine can process publish.start from editing.draft.idle.
    // When already editing, edit.start is a no-op (unhandled in editing state).
    send({type: 'edit.start'})
    send({type: 'publish.start', pathOverride})
  }

  const handlePublishTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (hasTriggeredPublish && canPublish) {
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
          />
        </PopoverContent>
      </Popover>
      <OptionsDropdown menuItems={allItems} align="end" side="bottom" />
      {deleteDraftDialog.content}
    </>
  )
}

/**
 * Combined right-actions for DocumentTools when editing.
 * Renders: save indicator, publish (with popover), new button, three-dots (merged menu).
 * Must be rendered inside DocumentMachineProvider.
 */
export function EditingDocToolsRight({
  docId,
  existingMenuItems,
  newButton,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  newButton?: ReactNode
}) {
  return (
    <div className="flex items-center gap-1">
      <SaveIndicator />
      <PublishButtonWithPopover docId={docId} existingMenuItems={existingMenuItems} />
      {newButton}
    </div>
  )
}

/**
 * Slim toolbar shown when a draft exists but the user is not actively editing.
 * Shows the publish button (with pulsing dot for unsaved changes) and the
 * options dropdown (with "Discard Changes" when a draft is present).
 * No SaveIndicator — autosave only runs during editing.
 * Must be rendered inside DocumentMachineProvider.
 */
export function DraftActionsToolbar({
  docId,
  existingMenuItems,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
}) {
  return (
    <div className="flex items-center gap-1">
      <PublishButtonWithPopover docId={docId} existingMenuItems={existingMenuItems} />
    </div>
  )
}
