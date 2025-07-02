import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
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
      <Text className="text-lg font-semibold">Discard Comment</Text>
      <Text className="text-muted-foreground text-sm">
        Permanently delete this draft comment?
      </Text>

      <div className="flex justify-end gap-3">
        <Button
          onClick={() => {
            onClose()
          }}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            input.onConfirm()
            onClose()
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}
