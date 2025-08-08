import {BlockSchema} from '../../../../../core'
import {useDocContentContext} from '@shm/ui/document-content'
import {Link} from '@shm/ui/icons'
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
      <div className="flex gap-2">
        <Link size={14} />
        Copy link to Block
      </div>
    </DragHandleMenuItem>
  )
}
