import React from 'react'
import {DocumentDeletionReferences} from './document-deletion-references'
import {Button} from './button'
import {Text} from './text'
import {toast} from './toast'
import {cn} from './utils'

import {DeletionDocumentList, type DeleteDocumentDialogItem} from './deletion-document-list'
export {DeletionDocumentList, type DeleteDocumentDialogItem} from './deletion-document-list'

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
        <DeletionDocumentList
          documents={childDocuments}
          label={`${childDocuments.length} ${
            childDocuments.length === 1 ? 'document' : 'documents'
          } will also be deleted`}
        />
      ) : null}

      <DocumentDeletionReferences documentIds={[document.key, ...childDocuments.map((child) => child.key)]} />

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
