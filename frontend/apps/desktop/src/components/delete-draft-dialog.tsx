import {useDraft} from '@/models/accounts'
import {useDeleteDraft} from '@/models/documents'
import {draftEditId} from '@/models/drafts'
import {Button} from '@shm/ui/button'
import {AlertDialogFooter, AlertDialogTitle} from '@shm/ui/components/alert-dialog'
import {Text} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'

export function useDeleteDraftDialog() {
  return useAppDialog(DeleteDraftDialog, {isAlert: true})
}

function DeleteDraftDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {
    draftId: string
    onSuccess?: () => void
    onConfirm?: () => void | Promise<void>
    /** Called when the user discards but keeps the referenced child drafts. */
    onConfirmKeepDrafts?: () => void | Promise<void>
    /** Number of unpublished child documents referenced by this draft's cards. */
    childDraftCount?: number
  }
}) {
  const deleteDraft = useDeleteDraft({
    onSettled: input.onSuccess,
  })
  const draft = useDraft(input.draftId)
  const editId = draftEditId(draft.data)

  return (
    <>
      <AlertDialogTitle>{editId ? 'Discard unpublished changes?' : 'Discard this Draft?'}</AlertDialogTitle>
      <Text className="text-muted-foreground text-sm">
        {editId
          ? 'Your unpublished changes will be discarded and the document will revert to its last published version.'
          : 'This draft document and all its content will be permanently deleted. This action cannot be undone.'}
      </Text>
      {input.childDraftCount ? (
        <Text className="text-muted-foreground text-sm">
          {`This draft contains ${input.childDraftCount} unpublished child document(s). Discarding removes their cards.`}
        </Text>
      ) : null}

      <AlertDialogFooter className="flex-col">
        <Button
          onClick={() => {
            onClose()
          }}
          variant="outline"
        >
          Cancel
        </Button>
        {input.childDraftCount && input.onConfirmKeepDrafts ? (
          <Button
            variant="outline"
            title="Not recommended"
            onClick={() => {
              void Promise.resolve(input.onConfirmKeepDrafts!()).then(input.onSuccess)
              onClose()
            }}
          >
            Discard and keep drafts (not recommended)
          </Button>
        ) : null}
        <Button
          variant="destructive"
          onClick={() => {
            if (input.onConfirm) {
              void Promise.resolve(input.onConfirm()).then(input.onSuccess)
            } else {
              deleteDraft.mutate(input.draftId)
            }
            onClose()
          }}
        >
          {input.childDraftCount ? 'Discard and delete drafts' : editId ? 'Yes, discard changes' : 'Yes, discard draft'}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
