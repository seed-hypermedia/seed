import {useDeleteDraftDialog} from '@/components/delete-draft-dialog'
import {useNavigationDispatch, useNavRoute} from '@/utils/navigation'
import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {Trash} from 'lucide-react'

export default function DiscardDraftButton() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  const draftId = route.key == 'draft' ? route.id : null
  const deleteDialog = useDeleteDraftDialog()
  if (route.key != 'draft') return null

  return (
    <>
      {deleteDialog.content}
      <Tooltip content="Discard Draft">
        <Button
          size="icon"
          variant="destructive"
          onClick={() => {
            if (draftId) {
              deleteDialog.open({
                draftId: draftId,
                onSuccess: () => {
                  dispatch({type: 'closeBack'})
                },
              })
            } else {
              dispatch({type: 'closeBack'})
            }
          }}
        >
          <Trash className="size-3" />
        </Button>
      </Tooltip>
    </>
  )
}
