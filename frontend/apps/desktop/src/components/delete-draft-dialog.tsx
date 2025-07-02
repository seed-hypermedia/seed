import {useDeleteDraft} from '@/models/documents'
import {Button} from '@shm/ui/button'
import {AlertDialog} from 'tamagui'
import {useAppDialog} from './dialog'

export function useDeleteDraftDialog() {
  return useAppDialog(DeleteDraftDialog, {isAlert: true})
}

function DeleteDraftDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {draftId: string; onSuccess?: () => void}
}) {
  const deleteDraft = useDeleteDraft({
    onSettled: input.onSuccess,
  })
  return (
    <div className="flex flex-col gap-4 rounded-md p-4" style={{maxWidth: 400}}>
      <AlertDialog.Title>Discard Draft</AlertDialog.Title>
      <AlertDialog.Description>
        Permanently delete this draft document?
      </AlertDialog.Description>

      <div className="flex justify-end gap-3">
        <AlertDialog.Cancel asChild>
          <Button
            onClick={() => {
              onClose()
            }}
            variant="ghost"
          >
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action asChild>
          <Button
            variant="destructive"
            onClick={() => {
              deleteDraft.mutate(input.draftId)
              onClose()
            }}
          >
            Delete
          </Button>
        </AlertDialog.Action>
      </div>
    </div>
  )
}
