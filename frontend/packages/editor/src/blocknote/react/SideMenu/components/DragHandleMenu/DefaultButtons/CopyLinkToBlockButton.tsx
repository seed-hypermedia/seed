import {useBlocksContentContext} from '@shm/ui/document-content'
import {Link} from '@shm/ui/icons'
import {BlockSchema} from '../../../../../core'
import {DragHandleMenuProps} from '../DragHandleMenu'
import {DragHandleMenuItem} from '../DragHandleMenuItem'

export const CopyLinkToBlockButton = <BSchema extends BlockSchema>({
  block,
}: DragHandleMenuProps<BSchema>) => {
  const {onBlockSelect} = useBlocksContentContext()
  if (!onBlockSelect) return null
  return (
    <DragHandleMenuItem
      onClick={() => {
        onBlockSelect(block.id)
      }}
    >
      <div className="flex gap-2">
        <Link size={14} />
        Copy link to Block
      </div>
    </DragHandleMenuItem>
  )
}
