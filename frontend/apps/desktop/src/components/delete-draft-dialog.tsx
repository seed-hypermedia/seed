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
  input: {draftId: string; onSuccess?: () => void; onConfirm?: () => void | Promise<void>}
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

      <AlertDialogFooter className="flex-col">
        <Button
          onClick={() => {
            onClose()
          }}
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (input.onConfirm) {
              void Promise.resolve(input.onConfirm()).then(input.onSuccess)
            } else {
              deleteDraft.mutate(input.draftId)
            }
            onClose()
          }}
        >
          {editId ? 'Yes, discard changes' : 'Yes, discard draft'}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
