import {DocumentDeletionReferences} from './document-deletion-references'
import {getCleanupJobParent, type DocumentCardCleanupJob} from '@shm/shared/models/document-card-cleanup-machine'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {AlertCircle, ListChecks} from 'lucide-react'
import {createContext, useContext, useRef, useState, type ReactNode, type MouseEvent} from 'react'
import {Button} from './button'
import {SmallListItem} from './list-item'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from './components/dialog'

/** One durable maintenance action shown in the device-local recovery list. */
export type DocumentMaintenanceItem = {
  id: string
  title: string
  needsAttention: boolean
  status: string
  error?: string
  progress?: string[]
  documents: {id: string; label: string}[]
  /** False when retry would require a new destructive confirmation. */
  canRetry: boolean
  dismissedAt?: number
  createdAt?: number
  updatedAt?: number
  attempts?: number
  canReviewDeletion?: boolean
}

/** Adapts parent-reference jobs without claiming incomplete steps have succeeded. */
export function documentCleanupItems(jobs: DocumentCardCleanupJob[]): DocumentMaintenanceItem[] {
  return jobs
    .filter((job) => job.state !== 'done' && job.state !== 'skippedTerminal')
    .map((job) => {
      const operation = job.operation || 'remove'
      const phase = {
        idle: 'Queued',
        awaitingPrimary: 'Waiting for document action to complete',
        loadingParent: 'Loading parent',
        updating: 'Updating references',
        publishing: 'Publishing parent correction',
        verifying: 'Verifying correction',
        retryScheduled: 'Waiting to retry',
        failed: 'Retrying after a failure',
        failedNeedsAttention: 'Automatic attempts exhausted',
        dismissed: 'Dismissed without repairing',
      }
      const ids = [getCleanupJobParent(job).id, job.target?.id || job.source?.id]
      return {
        id: job.id,
        title:
          operation === 'delete-child'
            ? 'Delete confirmed child document'
            : operation === 'add'
              ? 'Add child card'
              : operation === 'rewrite'
                ? 'Update document references'
                : 'Remove child card',
        needsAttention: job.state === 'failedNeedsAttention',
        dismissedAt: job.state === 'dismissed' ? job.dismissedAt ?? job.updatedAt : undefined,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        attempts: job.attempts,
        status: `${phase[job.state as keyof typeof phase] || job.state} · ${job.attempts} failed attempt${
          job.attempts === 1 ? '' : 's'
        }`,
        error: job.lastError,
        documents: ids
          .filter((id): id is string => !!id)
          .filter((id, index, all) => all.indexOf(id) === index)
          .map((id) => {
            const unpacked = unpackHmId(id)
            return {id, label: unpacked ? `/${unpacked.path?.join('/') || ''}` : id}
          }),
        canRetry:
          operation !== 'delete-child' &&
          (job.state === 'failedNeedsAttention' || job.state === 'dismissed') &&
          !job.lastError?.includes('Confirmation required:'),
        canReviewDeletion:
          operation === 'delete-child' && (job.state === 'failedNeedsAttention' || job.state === 'dismissed'),
        progress: job.publishedVersion ? [`Parent published at ${job.publishedVersion}`] : undefined,
      }
    })
}

const DocumentMaintenanceContext = createContext<{
  count: number
  historyCount: number
  attentionCount: number
  loadError?: string
  openDialog: (trigger: HTMLElement) => void
} | null>(null)

/** Gives navigation and settings access to the root-owned recovery dialog, when available. */
export function useDocumentMaintenance() {
  return useContext(DocumentMaintenanceContext)
}

/** Opens the shared recovery dialog from sidebar rows or compact web navigation. */
export function DocumentMaintenanceTrigger({
  compact = false,
  onClick,
  alwaysVisible = false,
}: {
  compact?: boolean
  onClick?: () => void
  alwaysVisible?: boolean
}) {
  const maintenance = useContext(DocumentMaintenanceContext)
  if (!maintenance || (!alwaysVisible && !maintenance.count && !maintenance.historyCount && !maintenance.loadError))
    return null
  const attention = maintenance.attentionCount > 0 || !!maintenance.loadError
  const label = alwaysVisible
    ? 'Document maintenance'
    : attention
      ? `Needs attention${maintenance.attentionCount ? ` (${maintenance.attentionCount})` : ''}`
      : maintenance.count
        ? `Document maintenance (${maintenance.count})`
        : 'Document maintenance'
  const icon = attention ? <AlertCircle className="size-4" /> : <ListChecks className="size-4" />
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    maintenance.openDialog(event.currentTarget)
    onClick?.()
  }
  return compact ? (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={open}>
      {icon}
    </Button>
  ) : (
    <SmallListItem title={label} icon={icon} bold onClick={open} aria-haspopup="dialog" />
  )
}

/** Compact notification-page notice linking to the same device-local recovery dialog. */
export function DocumentMaintenanceBanner() {
  const maintenance = useContext(DocumentMaintenanceContext)
  if (!maintenance || (!maintenance.count && !maintenance.loadError)) return null
  const {attentionCount, count, loadError} = maintenance
  const attention = attentionCount > 0 || !!loadError
  return (
    <button
      type="button"
      onClick={(event) => maintenance.openDialog(event.currentTarget)}
      aria-haspopup="dialog"
      className="border-border bg-muted/50 hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {attention ? (
        <AlertCircle className="text-destructive size-4 shrink-0" />
      ) : (
        <ListChecks className="text-muted-foreground size-4 shrink-0" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium">
          {loadError
            ? 'Document maintenance needs attention'
            : attentionCount
              ? `${attentionCount} ${attentionCount === 1 ? 'action needs' : 'actions need'} your attention`
              : `${count} document ${count === 1 ? 'action is' : 'actions are'} in progress`}
        </span>
        <span className="text-muted-foreground text-xs">
          {attention
            ? 'Review document reference updates that could not be completed.'
            : 'Reference updates are running on this device.'}
        </span>
      </span>
      <span className="text-primary shrink-0 text-sm font-medium">Review</span>
    </button>
  )
}

/** Persistent entry point for pending work and failures; dismissing never repairs documents. */
export function DocumentMaintenance({
  items,
  onRetry,
  onDismiss,
  onOpenDocument,
  onReviewDeletion,
  onConfirmDeletion,
  onClearDismissed,
  loadError,
  children,
}: {
  children?: ReactNode
  items: DocumentMaintenanceItem[]
  onClearDismissed?: () => Promise<unknown>
  onRetry: (id: string) => Promise<unknown>
  onDismiss: (id: string) => Promise<unknown>
  onOpenDocument: (id: string) => void
  onReviewDeletion?: (id: string) => Promise<Array<{id: string; version: string}>>
  onConfirmDeletion?: (id: string, documents: Array<{id: string; version: string}>) => Promise<unknown>
  loadError?: string
}) {
  const [view, setView] = useState<'active' | 'dismissed'>('active')
  const [confirmClear, setConfirmClear] = useState(false)
  const [copied, setCopied] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deletionReview, setDeletionReview] = useState<{
    jobId: string
    documents: Array<{id: string; version: string}>
  } | null>(null)
  const [dismissId, setDismissId] = useState<string | null>(null)
  const activeItems = items.filter((item) => item.dismissedAt === undefined)
  const dismissedItems = items
    .filter((item) => item.dismissedAt !== undefined)
    .sort((a, b) => b.dismissedAt! - a.dismissedAt!)
  const visibleItems = view === 'dismissed' ? dismissedItems : activeItems
  const attentionCount = activeItems.filter((item) => item.needsAttention).length
  const action = async (id: string, callback: (id: string) => Promise<unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      await callback(id)
      setDismissId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this maintenance action. Please try again.')
    } finally {
      setBusyId(null)
    }
  }
  return (
    <DocumentMaintenanceContext.Provider
      value={{
        count: activeItems.length,
        historyCount: dismissedItems.length,
        attentionCount,
        loadError,
        openDialog: (trigger) => {
          triggerRef.current = trigger
          setOpen(true)
        },
      }}
    >
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[80vh] overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={(event) => {
            if (triggerRef.current?.isConnected) {
              event.preventDefault()
              triggerRef.current.focus()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Document maintenance</DialogTitle>
            <DialogDescription>
              Pending reference updates on this device. Your completed document actions are not reversed when
              maintenance fails.
            </DialogDescription>
          </DialogHeader>
          {(loadError || error) && (
            <p role="alert" className="text-destructive text-sm">
              {loadError || error}
            </p>
          )}
          <div className="flex gap-2" role="group" aria-label="Maintenance view">
            <Button
              size="sm"
              variant={view === 'active' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'active'}
              onClick={() => setView('active')}
            >
              Active ({activeItems.length})
            </Button>
            <Button
              size="sm"
              variant={view === 'dismissed' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'dismissed'}
              onClick={() => setView('dismissed')}
            >
              Dismissed ({dismissedItems.length})
            </Button>
          </div>
          {view === 'dismissed' && (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                Dismissed does not mean repaired. History stays on this device for up to 90 days, keeping the latest 500
                dismissed actions.
              </p>
              {!!dismissedItems.length && (
                <>
                  <p className="text-muted-foreground text-xs">
                    Diagnostic reports include document IDs, paths and error messages. Share only with people you trust;
                    nothing is uploaded automatically.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId !== null}
                      onClick={() =>
                        action('diagnostics', async () => {
                          setCopied(false)
                          await navigator.clipboard.writeText(
                            JSON.stringify({exportedAt: new Date().toISOString(), actions: dismissedItems}, null, 2),
                          )
                          setCopied(true)
                        })
                      }
                    >
                      {copied ? 'Report copied' : 'Copy diagnostic report'}
                    </Button>
                    {onClearDismissed && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId !== null}
                        onClick={() => setConfirmClear(true)}
                      >
                        Clear history…
                      </Button>
                    )}
                  </div>
                </>
              )}
              {confirmClear && onClearDismissed && (
                <div className="bg-muted flex flex-col gap-3 rounded-md p-3">
                  <p className="text-sm">
                    Permanently remove dismissed records from this device? This does not repair documents or remove
                    active jobs.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId !== null}
                      onClick={() =>
                        action('clear-history', async () => {
                          await onClearDismissed()
                          setConfirmClear(false)
                        })
                      }
                    >
                      Clear dismissed history
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!visibleItems.length && !loadError && (
            <p className="text-muted-foreground text-sm">
              {view === 'dismissed' ? 'No dismissed actions.' : 'No active document actions.'}
            </p>
          )}
          <div className="flex flex-col gap-4">
            {visibleItems.map((item) => (
              <section key={item.id} className="border-border rounded-lg border p-4" aria-label={item.title}>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{item.title}</h3>
                    <span className="text-muted-foreground text-xs">
                      {item.dismissedAt !== undefined
                        ? 'Dismissed without repairing'
                        : item.needsAttention
                          ? 'Needs attention'
                          : 'In progress'}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">{item.status}</p>
                  {item.dismissedAt !== undefined && (
                    <p className="text-muted-foreground text-xs">
                      Dismissed{' '}
                      <time dateTime={new Date(item.dismissedAt).toISOString()}>
                        {new Date(item.dismissedAt).toLocaleString()}
                      </time>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {item.documents.map((doc) => (
                      <Button
                        key={doc.id}
                        variant="link"
                        size="sm"
                        className="max-w-full truncate px-0"
                        title={doc.id}
                        onClick={() => onOpenDocument(doc.id)}
                      >
                        Review {doc.label}
                      </Button>
                    ))}
                  </div>
                  {item.progress?.map((step) => (
                    <p key={step} className="text-muted-foreground text-xs">
                      Completed: {step}
                    </p>
                  ))}
                  {item.error && <p className="text-destructive text-sm break-words">{item.error}</p>}
                  {(item.needsAttention || item.dismissedAt !== undefined) && (
                    <div className="flex flex-col gap-2">
                      {!item.canRetry && (
                        <p className="text-muted-foreground text-sm">
                          Review this document and confirm the current deletion scope before proceeding. Retrying cannot
                          authorize additional deletions.
                        </p>
                      )}
                      <div className="flex gap-2">
                        {item.canReviewDeletion && onReviewDeletion && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId !== null}
                            onClick={() =>
                              action(item.id, async (id) => {
                                setDeletionReview(null)
                                const documents = await onReviewDeletion(id)
                                setDeletionReview({jobId: id, documents})
                              })
                            }
                          >
                            Review deletion
                          </Button>
                        )}
                        {item.canRetry && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId !== null}
                            loading={busyId === item.id}
                            onClick={() => action(item.id, onRetry)}
                          >
                            {item.dismissedAt !== undefined ? 'Review and retry' : 'Retry'}
                          </Button>
                        )}
                        {item.dismissedAt === undefined && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId !== null}
                            onClick={() => setDismissId(item.id)}
                          >
                            Dismiss…
                          </Button>
                        )}
                      </div>
                      {deletionReview?.jobId === item.id && onConfirmDeletion && (
                        <div className="bg-muted flex flex-col gap-3 rounded-md p-3">
                          <p className="text-sm font-semibold">Confirm the current deletion scope</p>
                          <p className="text-sm">
                            These documents will be deleted. This approval applies only to the listed versions. If
                            anything changes again, deletion will stop for another review.
                          </p>
                          <DocumentDeletionReferences
                            documentIds={deletionReview.documents.map((document) => document.id)}
                          />
                          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
                            {deletionReview.documents.map((document) => (
                              <li key={document.id} className="break-all">
                                <span>{document.id}</span>
                                <span className="text-muted-foreground block text-xs">Version: {document.version}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyId !== null || !deletionReview.documents.length}
                              onClick={() =>
                                action(item.id, async (id) => {
                                  await onConfirmDeletion(id, deletionReview.documents)
                                  setDeletionReview(null)
                                })
                              }
                            >
                              Confirm deletion of {deletionReview.documents.length}{' '}
                              {deletionReview.documents.length === 1 ? 'document' : 'documents'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId !== null}
                              onClick={() => setDeletionReview(null)}
                            >
                              Cancel deletion review
                            </Button>
                          </div>
                        </div>
                      )}
                      {dismissId === item.id && (
                        <div className="bg-muted flex flex-col gap-2 rounded-md p-3">
                          <p className="text-sm">
                            Dismiss this action without repairing it? References may remain out of date. This does not
                            undo your document action.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId !== null}
                              onClick={() => action(item.id, onDismiss)}
                            >
                              Dismiss without repairing
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId !== null}
                              onClick={() => setDismissId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </DocumentMaintenanceContext.Provider>
  )
}
