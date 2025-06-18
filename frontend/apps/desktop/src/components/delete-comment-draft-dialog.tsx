import {Button} from '@shm/ui/button'
import {AlertDialog, XStack, YStack} from 'tamagui'
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
    <YStack space backgroundColor="$background" padding="$4" borderRadius="$3">
      <AlertDialog.Title>Discard Comment</AlertDialog.Title>
      <AlertDialog.Description>
        Permanently delete this draft comment?
      </AlertDialog.Description>

      <XStack space="$3" justifyContent="flex-end">
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
      </XStack>
    </YStack>
  )
}
