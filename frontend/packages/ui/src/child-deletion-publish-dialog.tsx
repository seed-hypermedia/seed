import {useContext} from 'react'
import {EditorHandlersContext} from '@shm/shared/models/editor-handlers-context'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useDocumentSelector, useDocumentSend} from '@shm/shared/models/use-document-machine'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/alert-dialog'
import {DocumentDeletionReferences} from './document-deletion-references'
import {XIcon} from 'lucide-react'
import {DeletionDocumentList} from './delete-document-dialog'

/** Confirms the exact destructive scope before publishing a parent's last-reference removals. */
export function ChildDeletionPublishDialog() {
  const isEditing = useDocumentSelector((snapshot) => snapshot.matches('editing'))
  const confirming = useDocumentSelector((snapshot) => snapshot.matches({publishing: 'confirmingChildDeletion'}))
  const failed = useDocumentSelector((snapshot) => snapshot.matches({publishing: 'childDeletionFailed'}))
  const confirmations = useDocumentSelector((snapshot) => snapshot.context.confirmedChildDeletions)
  const error = useDocumentSelector((snapshot) => snapshot.context.childDeletionError)
  const send = useDocumentSend()
  const editorHandlers = useContext(EditorHandlersContext)
  const documents = confirmations.flatMap((confirmation) => confirmation.documents)
  return (
    <AlertDialog
      open={confirming || failed}
      onOpenChange={(open) => {
        if (!open) send({type: 'publish.cancelChildDeletion'})
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (isEditing && editorHandlers?.current?.focus) {
            event.preventDefault()
            editorHandlers.current.focus()
          }
        }}
      >
        <AlertDialogCancel variant="ghost" size="icon" aria-label="Back to editing" className="absolute top-4 right-4">
          <XIcon />
        </AlertDialogCancel>
        <AlertDialogHeader>
          <AlertDialogTitle className="pr-8">
            {failed ? 'Unable to review child deletions' : 'Publishing will delete child documents'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {failed
              ? `Your draft is safe and has not been published. ${error} You can still publish without deleting any child documents.`
              : 'The last reference to these direct children was removed from their parent. Publish and delete removes these documents and their listed descendants. Publish without deleting keeps them as child documents.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!failed && (
          <DeletionDocumentList
            documents={documents.map((document) => {
              const path = unpackHmId(document.id)?.path
              return {
                key: document.id,
                title: document.title || path?.[path.length - 1] || 'Untitled document',
                path,
              }
            })}
            label={`${documents.length} ${documents.length === 1 ? 'document' : 'documents'} will be deleted`}
          />
        )}
        {confirming && !failed && <DocumentDeletionReferences documentIds={documents.map((document) => document.id)} />}
        <AlertDialogFooter className="sm:flex-wrap">
          <AlertDialogAction
            variant="outline"
            onClick={(event) => {
              event.preventDefault()
              send({type: 'publish.skipChildDeletion'})
            }}
          >
            Publish without deleting
          </AlertDialogAction>
          {!failed && (
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault()
                send({type: 'publish.confirmChildDeletion'})
              }}
            >
              Publish and delete {documents.length} {documents.length === 1 ? 'document' : 'documents'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
