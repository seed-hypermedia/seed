import {BlockSchema} from '@/blocknote/core'
import {useDocContentContext} from '@shm/ui/document-content'
import {Link} from '@shm/ui/icons'
import {XStack} from 'tamagui'
import {DragHandleMenuProps} from '../DragHandleMenu'
import {DragHandleMenuItem} from '../DragHandleMenuItem'

export const CopyLinkToBlockButton = <BSchema extends BlockSchema>({
  block,
}: DragHandleMenuProps<BSchema>) => {
  const {onBlockCopy} = useDocContentContext()
  if (!onBlockCopy) return null
  return (
    <DragHandleMenuItem
      onClick={() => {
        onBlockCopy(block.id)
      }}
    >
      <XStack gap="$2">
        <Link size={14} />
        Copy link to Block
      </XStack>
    </DragHandleMenuItem>
  )
}
