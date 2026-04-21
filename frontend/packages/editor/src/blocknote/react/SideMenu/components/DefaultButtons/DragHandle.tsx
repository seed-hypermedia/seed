import {useEffect, useRef} from 'react'
import {MdDragIndicator} from 'react-icons/md'
import {BlockSchema} from '../../../../core'
import {setupBlockDraggable} from '../../../../core/extensions/SideMenu/pragmatic-dnd-bridge'
import {SideMenuButton} from '../SideMenuButton'
import {SideMenuProps} from '../SideMenuPositioner'

export const DragHandle = <BSchema extends BlockSchema>(props: SideMenuProps<BSchema>) => {
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
    <div ref={dragRef} data-drag-handle>
      <SideMenuButton>
        <MdDragIndicator size={24} data-test={'dragHandle'} />
      </SideMenuButton>
    </div>
  )
}
