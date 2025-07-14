import {useDeleteDraft} from '@/models/documents'
import {Button} from '@shm/ui/button'
import {
  AlertDialogFooter,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'

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
  input: {draftId: string; onSuccess?: () => void}
}) {
  const deleteDraft = useDeleteDraft({
    onSettled: input.onSuccess,
  })
  return (
    <>
      <AlertDialogTitle>Discard Draft</AlertDialogTitle>
      <Text className="text-muted-foreground text-sm">
        Permanently delete this draft document?
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
          variant="destructive"
          onClick={() => {
            deleteDraft.mutate(input.draftId)
            onClose()
          }}
        >
          Delete
        </Button>
      </AlertDialogFooter>
    </>
  )
}
