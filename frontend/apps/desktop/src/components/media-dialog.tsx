import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'

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
      <Text className="text-lg font-semibold">Commit Document</Text>
      <Text className="text-muted-foreground text-sm">
        All empty media elements will be deleted in your publication. Do you
        wish to proceed?
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
      </div>
    </div>
  )
}
