import {Button} from '@shm/ui/button'
import {toast} from '@shm/ui/toast'
import {AlertDialog} from 'tamagui'
import {useAppDialog} from './dialog'

export function useMediaDialog() {
  return useAppDialog(MediaDialog, {isAlert: true})
}

function MediaDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {draftId: string | undefined; publish: any}
}) {
  return (
    <div className="bg-background flex flex-col gap-2 rounded-md p-4">
      <AlertDialog.Title>Commit Document</AlertDialog.Title>
      <AlertDialog.Description>
        All empty media elements will be deleted in your publication. Do you
        wish to proceed?
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
            variant="default"
            onClick={() => {
              if (input.draftId) {
                try {
                  input.publish.mutate({draftId: input.draftId})
                } catch (e: any) {
                  toast.error('Failed to publish: ' + e)
                }
              }
              onClose()
            }}
          >
            Commit
          </Button>
        </AlertDialog.Action>
      </div>
    </div>
  )
}
