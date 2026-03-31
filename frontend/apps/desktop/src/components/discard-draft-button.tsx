import {useDraft} from '@/models/accounts'
import {useDeleteDraft} from '@/models/documents'
import {draftEditId} from '@/models/drafts'
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
  const draft = useDraft(draftId ?? undefined)
  const editId = draftEditId(draft.data)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const deleteDraft = useDeleteDraft()
  if (route.key != 'draft') return null

  return (
    <>
      <Tooltip content="Discard changes">
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
          <AlertDialogTitle>{editId ? 'Discard Changes in this Document?' : 'Discard this Draft?'}</AlertDialogTitle>
          <p className="text-muted-foreground text-sm">
            {editId
              ? 'All changes made to the current version of this document will be permanently deleted. This action cannot be undone.'
              : 'This draft document and all its content will be permanently deleted. This action cannot be undone.'}
          </p>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => setShowExitDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
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
              {editId ? 'Yes, discard changes' : 'Yes, discard draft'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
