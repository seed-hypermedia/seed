import {BlockSchema} from '../../../../../core'
import {Delete} from '@shm/ui/icons'
import {ReactNode} from 'react'
import {DragHandleMenuProps} from '../DragHandleMenu'
import {DragHandleMenuItem} from '../DragHandleMenuItem'

export const RemoveBlockButton = <BSchema extends BlockSchema>(
  props: DragHandleMenuProps<BSchema> & {children: ReactNode},
) => {
  return (
    <DragHandleMenuItem
      onClick={() => props.editor.removeBlocks([props.block])}
    >
      <div className="flex gap-2">
        <Delete size={14} />
        {props.children}
      </div>
    </DragHandleMenuItem>
  )
}
