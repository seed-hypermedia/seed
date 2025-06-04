import {useDeleteDraft} from '@/models/documents'
import {Button} from '@shm/ui/button'
import {AlertDialog, XStack, YStack} from 'tamagui'
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
    <YStack gap="$4" padding="$4" borderRadius="$3" maxWidth={400}>
      <AlertDialog.Title>Discard Draft</AlertDialog.Title>
      <AlertDialog.Description>
        Permanently delete this draft document?
      </AlertDialog.Description>

      <XStack gap="$3" justifyContent="flex-end">
        <AlertDialog.Cancel asChild>
          <Button
            onPress={() => {
              onClose()
            }}
            chromeless
          >
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action asChild>
          <Button
            theme="red"
            onPress={() => {
              deleteDraft.mutate(input.draftId)
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
