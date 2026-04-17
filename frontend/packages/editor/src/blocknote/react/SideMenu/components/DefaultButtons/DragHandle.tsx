import {useEffect, useRef} from 'react'
import {BlockSchema} from '../../../../core'
import {setupBlockDraggable} from '../../../../core/extensions/SideMenu/pragmatic-dnd-bridge'
import {Menu} from '@mantine/core'
import {MdDragIndicator} from 'react-icons/md'
import {DefaultDragHandleMenu} from '../DragHandleMenu/DefaultDragHandleMenu'
import {SideMenuButton} from '../SideMenuButton'
import {SideMenuProps} from '../SideMenuPositioner'

export const DragHandle = <BSchema extends BlockSchema>(props: SideMenuProps<BSchema>) => {
  const DragHandleMenu = props.dragHandleMenu || DefaultDragHandleMenu
  const dragRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = dragRef.current
    if (!el) return
    if (!props.editor.dragStateManager || !props.editor.editorDragId) return

    return setupBlockDraggable(
      el,
      el,
      () => props.block?.id,
      props.editor,
      props.editor.dragStateManager,
      props.editor.editorDragId,
    )
  }, [props.editor, props.block?.id])

  return (
    <Menu trigger={'click'} onOpen={props.freezeMenu} onClose={props.unfreezeMenu} width={100} position={'left'}>
      <Menu.Target>
        <div ref={dragRef} data-drag-handle>
          <SideMenuButton>
            <MdDragIndicator size={24} data-test={'dragHandle'} />
          </SideMenuButton>
        </div>
      </Menu.Target>
      <DragHandleMenu editor={props.editor} block={props.block} />
    </Menu>
  )
}
