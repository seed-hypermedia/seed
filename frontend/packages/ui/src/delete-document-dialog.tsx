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
  const deletedDocumentCount = childDocuments.length + 1
  const documentLabel = deletedDocumentCount === 1 ? 'document' : 'documents'
  const hasChildren = childDocuments.length > 0
  const items = [document, ...childDocuments]

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
    <div
      className={cn(
        
        className,
      )}
    >
      <div className="flex shrink-0 flex-col gap-3 p-4 pb-3">
        <Text className="text-lg font-semibold">Delete &quot;{document.title}&quot;</Text>
        <Text className="text-muted-foreground text-sm">
          Are you sure you want to delete {hasChildren ? 'these documents' : 'this document'}? This may break links that
          refer to the current {hasChildren ? 'versions' : 'version'}.
        </Text>
        <Text className="text-muted-foreground text-sm">
          {hasChildren ? 'They' : 'It'} will be removed from your directory but the content will remain on your
          computer, and other people may still have it saved.
        </Text>
        <Text className="text-muted-foreground text-sm">
          Note: This feature is a work-in-progress. For now, the raw document data will continue to be synced with other
          peers. Soon we will avoid that. Eventually, you will be able to recover deleted documents.
        </Text>
      </div>

      <div
        className="border-border min-h-0 flex-1 overflow-y-auto border-y px-4 py-3"
        data-testid="delete-document-scroll-list"
      >
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <DeletionListItem key={item.key} item={item} />
          ))}
        </div>
      </div>

      <div className="bg-background flex shrink-0 justify-end gap-3 p-4" data-testid="delete-document-footer">
        <Button onClick={onClose} variant="outline" disabled={isDeleting}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
          {hasChildren ? 'Delete Documents' : 'Delete Document'}
        </Button>
      </div>
    </div>
  )
}

function DeletionListItem({item}: {item: DeleteDocumentDialogItem}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <Text className="text-destructive min-w-0 flex-1 truncate line-through">{item.title}</Text>
      <Text className="text-destructive/70 shrink-0 line-through">{item.path?.join('/') || '?'}</Text>
    </div>
  )
}
