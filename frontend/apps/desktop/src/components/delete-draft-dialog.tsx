import {useDeleteDraft} from '@/models/documents'
import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
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
      <Text className="text-lg font-semibold">Discard Draft</Text>
      <Text className="text-muted-foreground text-sm">
        Permanently delete this draft document?
      </Text>

      <div className="flex justify-end gap-3">
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
      </div>
    </div>
  )
}
