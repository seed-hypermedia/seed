import {BlockSchema} from '@/blocknote/core'
import {Delete} from '@shm/ui/icons'
import {ReactNode} from 'react'
import {XStack} from 'tamagui'
import {DragHandleMenuProps} from '../DragHandleMenu'
import {DragHandleMenuItem} from '../DragHandleMenuItem'

export const RemoveBlockButton = <BSchema extends BlockSchema>(
  props: DragHandleMenuProps<BSchema> & {children: ReactNode},
) => {
  return (
    <DragHandleMenuItem
      onClick={() => props.editor.removeBlocks([props.block])}
    >
      <XStack gap="$2">
        <Delete size={14} />
        {props.children}
      </XStack>
    </DragHandleMenuItem>
  )
}
