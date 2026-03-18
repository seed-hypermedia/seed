import {useDeleteDraft} from '@/models/documents'
import {clearNavigationGuard} from '@/utils/navigation-container'
import {useNavigationDispatch, useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {AlertDialog, AlertDialogContent, AlertDialogFooter, AlertDialogTitle} from '@shm/ui/components/alert-dialog'
import {Tooltip} from '@shm/ui/tooltip'
import {Undo} from '@shm/ui/icons'
import {useState} from 'react'

export default function DiscardDraftButton() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  const draftId = route.key == 'draft' ? route.id : null
  const [showExitDialog, setShowExitDialog] = useState(false)
  const deleteDraft = useDeleteDraft()
  if (route.key != 'draft') return null

  return (
    <>
      <Tooltip content="Exit editing">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (draftId) {
              setShowExitDialog(true)
            } else {
              dispatch({type: 'closeBack'})
            }
          }}
        >
          <Undo className="size-4" />
        </Button>
      </Tooltip>
      <AlertDialog open={showExitDialog} onOpenChange={(open) => !open && setShowExitDialog(false)}>
        <AlertDialogContent>
          <AlertDialogTitle>Exit editing</AlertDialogTitle>
          <p className="text-muted-foreground text-sm">
            You have unsaved changes. Would you like to save them before leaving?
          </p>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowExitDialog(false)
                if (draftId) {
                  deleteDraft.mutate(draftId, {
                    onSettled: () => {
                      clearNavigationGuard()
                      dispatch({type: 'closeBack'})
                    },
                  })
                }
              }}
            >
              Leave without saving
            </Button>
            <Button
              onClick={() => {
                setShowExitDialog(false)
                clearNavigationGuard()
                dispatch({type: 'closeBack'})
              }}
            >
              Save changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
