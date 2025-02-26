import {Block, BlockNoteEditor, BlockSchema} from '@/blocknote/core'
import {Menu, createStyles} from '@mantine/core'
import {ReactNode} from 'react'

export type DragHandleMenuProps<BSchema extends BlockSchema> = {
  editor: BlockNoteEditor<BSchema>
  block: Block<BSchema>
}

export const DragHandleMenu = (props: {children: ReactNode}) => {
  const {classes} = createStyles({
    root: {
      minWidth: 180,
    },
  })(undefined, {
    name: 'DragHandleMenu',
  })

  return (
    <Menu.Dropdown className={classes.root}>{props.children}</Menu.Dropdown>
  )
}
