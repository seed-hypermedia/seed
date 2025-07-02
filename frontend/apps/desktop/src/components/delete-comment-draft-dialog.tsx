import {Button} from '@shm/ui/button'
import {AlertDialog} from 'tamagui'
import {useAppDialog} from './dialog'

export function useDeleteCommentDraftDialog() {
  return useAppDialog(DeleteCommentDraftDialog, {isAlert: true})
}

function DeleteCommentDraftDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {onConfirm: () => void}
}) {
  return (
    <div className="bg-background flex flex-col gap-2 rounded-md p-4">
      <AlertDialog.Title>Discard Comment</AlertDialog.Title>
      <AlertDialog.Description>
        Permanently delete this draft comment?
      </AlertDialog.Description>

      <div className="flex justify-end gap-3">
        <AlertDialog.Cancel asChild>
          <Button
            onClick={() => {
              onClose()
            }}
          >
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action asChild>
          <Button
            variant="destructive"
            onClick={() => {
              input.onConfirm()
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
