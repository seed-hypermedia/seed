import React from 'react'
import {Button} from './button'
import {Text} from './text'
import {toast} from './toast'
import {cn} from './utils'

export type DeleteDocumentDialogItem = {
  key: string
  title: string
  path?: string[] | null
}

export type DeleteDocumentDialogProps = {
  document: DeleteDocumentDialogItem
  childDocuments?: DeleteDocumentDialogItem[]
  canDelete?: boolean
  cannotDeleteReason?: string
  onConfirm: () => Promise<void> | void
  onClose?: () => void
  onSuccess?: () => void
  className?: string
}

/** Shared confirmation UI for deleting a document and its child documents. */
export function DeleteDocumentDialog({
  document,
  childDocuments = [],
  canDelete = true,
  cannotDeleteReason = 'Not allowed to delete',
  onConfirm,
  onClose,
  onSuccess,
  className,
}: DeleteDocumentDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [showChildDocuments, setShowChildDocuments] = React.useState(false)
  const childDocumentListId = React.useId()
  const deletedDocumentCount = childDocuments.length + 1
  const documentLabel = deletedDocumentCount === 1 ? 'document' : 'documents'
  const hasChildren = childDocuments.length > 0
  const childDocumentLabel = childDocuments.length === 1 ? 'document' : 'documents'

  async function handleConfirm() {
    if (!canDelete) {
      toast.error(cannotDeleteReason)
      return
    }

    const deletePromise = Promise.resolve(onConfirm())
    setIsDeleting(true)
    toast.promise(deletePromise, {
      loading: deletedDocumentCount === 1 ? 'Deleting document…' : `Deleting ${deletedDocumentCount} documents…`,
      success:
        deletedDocumentCount === 1
          ? 'Successfully deleted document'
          : `Successfully deleted ${deletedDocumentCount} documents`,
      error: (error) => {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return deletedDocumentCount === 1
          ? `Failed to delete document: ${message}`
          : `Failed to delete ${documentLabel}: ${message}`
      },
    })

    try {
      await deletePromise
      onClose?.()
      onSuccess?.()
    } catch {
      // The toast already presents the error; keep the dialog open for retry.
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-7', className)}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-destructive/15 flex size-8 shrink-0 items-center justify-center rounded-full">
            <span className="bg-destructive text-destructive-foreground flex size-6 items-center justify-center rounded-full text-base leading-none font-bold">
              !
            </span>
          </span>
          <Text className="min-w-0 text-2xl leading-tight font-semibold">Delete &quot;{document.title}&quot;?</Text>
        </div>
        <Text className="text-muted-foreground text-base leading-7">
          This permanently removes the document and all its content. Links pointing to it from other documents will
          break.
        </Text>
      </div>

      {hasChildren ? (
        <div
          className="border-destructive/20 bg-destructive/[0.03] overflow-hidden rounded-lg border"
          data-testid="delete-document-child-section"
        >
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <Text className="text-base font-semibold">
              {childDocuments.length} {childDocumentLabel} will also be deleted
            </Text>
            <button
              type="button"
              aria-controls={showChildDocuments ? childDocumentListId : undefined}
              aria-expanded={showChildDocuments}
              className="text-primary hover:text-primary/80 focus-visible:ring-ring/50 rounded-sm text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]"
              onClick={() => setShowChildDocuments((visible) => !visible)}
            >
              {showChildDocuments ? 'Hide' : 'Show'}
            </button>
          </div>
          {showChildDocuments ? (
            <div
              id={childDocumentListId}
              className="border-border max-h-56 overflow-y-auto border-t px-4 py-3"
              data-testid="delete-document-child-list"
            >
              <div className="flex flex-col divide-y">
                {childDocuments.map((item) => (
                  <DeletionListItem key={item.key} item={item} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex shrink-0 justify-end gap-3" data-testid="delete-document-footer">
        <Button onClick={onClose} variant="outline" disabled={isDeleting}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
          Delete document
        </Button>
      </div>
    </div>
  )
}

function DeletionListItem({item}: {item: DeleteDocumentDialogItem}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-3" data-testid="delete-document-child-item">
      <Text className="truncate text-sm font-medium">{item.title}</Text>
      <Text className="text-muted-foreground truncate text-xs">{item.path?.join('/') || 'Unknown path'}</Text>
    </div>
  )
}
