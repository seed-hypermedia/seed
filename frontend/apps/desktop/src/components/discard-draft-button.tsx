import {useDeleteDraft} from '@/models/documents'
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
      <Tooltip content="Delete changes">
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
          <AlertDialogTitle>Delete draft?</AlertDialogTitle>
          <p className="text-muted-foreground text-sm">
            This will permanently delete this draft and all its changes. This action cannot be undone.
          </p>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setShowExitDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowExitDialog(false)
                if (draftId) {
                  deleteDraft.mutate(draftId, {
                    onSettled: () => {
                      dispatch({type: 'closeBack'})
                    },
                  })
                }
              }}
            >
              Yes, delete draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
