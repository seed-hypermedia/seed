import {Block, BlockNoteEditor, BlockSchema, DefaultBlockSchema, SideMenuProsemirrorPlugin} from '../../../core'
import {getGroupInfoFromPos} from '../../../core/extensions/Blocks/helpers/getGroupInfoFromPos'
import {useHideOnDocumentScroll} from '@shm/shared/models/use-document-machine'
import Tippy from '@tippyjs/react'
import {FC, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {DefaultSideMenu} from './DefaultSideMenu'
import {DragHandleMenuProps} from './DragHandleMenu/DragHandleMenu'
import {DropIndicator} from './DropIndicator'

export type SideMenuProps<BSchema extends BlockSchema = DefaultBlockSchema> = Pick<
  SideMenuProsemirrorPlugin<BSchema>,
  'blockDragStart' | 'blockDragEnd' | 'addBlock' | 'freezeMenu' | 'unfreezeMenu'
> & {
  block: Block<BSchema>
  editor: BlockNoteEditor<BSchema>
  dragHandleMenu?: FC<DragHandleMenuProps<BSchema>>
}

export const SideMenuPositioner = <BSchema extends BlockSchema = DefaultBlockSchema>(props: {
  editor: BlockNoteEditor<BSchema>
  sideMenu?: FC<SideMenuProps<BSchema>>
  placement?: 'left' | 'right'
}) => {
  const [show, setShow] = useState<boolean>(false)
  const [block, setBlock] = useState<Block<BSchema>>()
  const referencePos = useRef<DOMRect>()
  const [lh, setLh] = useState('')
  useEffect(() => {
    return props.editor.sideMenu!.onUpdate((sideMenuState) => {
      setShow(sideMenuState.show)
      setBlock(sideMenuState.block)
      referencePos.current = sideMenuState.referencePos
      setLh(sideMenuState.lineHeight)
    })
  }, [props.editor])

  const handleHide = useCallback(() => {
    props.editor.sideMenu!.unfreezeMenu()
    setShow(false)
  }, [props.editor])

  useHideOnDocumentScroll(handleHide)

  useEffect(() => {
    window.addEventListener('resize', handleHide)
    return () => {
      window.removeEventListener('resize', handleHide)
    }
  }, [handleHide])

  const getReferenceClientRect = useMemo(
    () => {
      if (!referencePos.current) {
        return undefined
      }

      const ref = referencePos.current
      // Return a rect covering only the first line of the block so Tippy
      // centers the side menu button at the top of the block, not its vertical center.
      const lhValue = parseInt(lh, 10) || 24
      const firstLineHeight = lhValue + 6 // include blockContent padding (3px top + 3px bottom)
      return () => new DOMRect(ref.x, ref.y, ref.width, firstLineHeight)
    },
    [referencePos.current, lh], // eslint-disable-line
  )

  const sideMenuElement = useMemo(() => {
    if (!block) {
      return null
    }

    const SideMenu = props.sideMenu || DefaultSideMenu

    return (
      <SideMenu
        block={block}
        editor={props.editor}
        blockDragStart={props.editor.sideMenu!.blockDragStart}
        blockDragEnd={props.editor.sideMenu!.blockDragEnd}
        addBlock={props.editor.sideMenu!.addBlock}
        freezeMenu={props.editor.sideMenu!.freezeMenu}
        unfreezeMenu={props.editor.sideMenu!.unfreezeMenu}
      />
    )
  }, [block, props.editor, props.sideMenu])

  // topOffset is 0 because getReferenceClientRect already returns a rect
  // covering only the first line of the block, so Tippy centers correctly.
  let topOffset = 0

  // Add right offset if the node is inside a list or blockquote
  let rightOffset = useMemo(() => {
    let offset = 8
    if (block && referencePos.current) {
      const ttEditor = props.editor._tiptapEditor
      const {view} = ttEditor
      const {state} = view
      // @ts-ignore
      state.doc.descendants((node, pos) => {
        if (node.attrs.id === block.id) {
          const {group} = getGroupInfoFromPos(pos, state)

          // 28 clears the 1.5em list gutter; 8 for non-list blocks
          offset = group.attrs.listType !== 'Group' ? 28 : 8
          return
        }
      })
    }
    return offset
  }, [referencePos.current])

  return (
    <>
      <Tippy
        appendTo={props.editor.domElement.parentElement ?? document.body}
        content={sideMenuElement}
        getReferenceClientRect={getReferenceClientRect}
        interactive={true}
        visible={show}
        animation={'fade'}
        offset={[topOffset, rightOffset]}
        placement={props.placement || 'left'}
        popperOptions={popperOptions}
      />
      {props.editor.dragStateManager && <DropIndicator stateManager={props.editor.dragStateManager} />}
    </>
  )
}
const popperOptions = {
  modifiers: [
    {
      name: 'flip',
      options: {
        fallbackPlacements: [],
      },
    },
    {
      name: 'preventOverflow',
      options: {
        mainAxis: false,
        altAxis: false,
      },
    },
  ],
}
