import {useDeleteDraftDialog} from '@/components/delete-draft-dialog'
import {useNavRoute} from '@/utils/navigation'
import {Button, Tooltip} from '@shm/ui'
import {Trash} from '@tamagui/lucide-icons'
import {useNavigationDispatch} from '../utils/navigation'

export default function DiscardDraftButton() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  const draftId = route.key == 'draft' ? route.id : null
  const deleteDialog = useDeleteDraftDialog()
  if (route.key != 'draft' || !draftId) return null
  return (
    <>
      {deleteDialog.content}
      <Tooltip content="Discard Draft">
        <Button
          size="$2"
          borderColor="$red5"
          bg="$red4"
          hoverStyle={{
            bg: '$red5',
            borderColor: '$red6',
          }}
          onPress={() =>
            deleteDialog.open({
              draftId: draftId.id,
              onSuccess: () => {
                dispatch({type: 'closeBack'})
              },
            })
          }
          icon={Trash}
        />
      </Tooltip>
    </>
  )
}
