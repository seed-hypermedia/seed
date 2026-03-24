import {Block, BlockNoteEditor, BlockSchema, DefaultBlockSchema, SideMenuProsemirrorPlugin} from '../../../core'
import {getGroupInfoFromPos} from '../../../core/extensions/Blocks/helpers/getGroupInfoFromPos'
import {scrollEvents} from '../../../../editor-on-scroll-stream'
import Tippy from '@tippyjs/react'
import {FC, useEffect, useMemo, useRef, useState} from 'react'
import {DefaultSideMenu} from './DefaultSideMenu'
import {DragHandleMenuProps} from './DragHandleMenu/DragHandleMenu'

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
    return props.editor.sideMenu.onUpdate((sideMenuState) => {
      setShow(sideMenuState.show)
      setBlock(sideMenuState.block)
      referencePos.current = sideMenuState.referencePos
      setLh(sideMenuState.lineHeight)
    })
  }, [props.editor])

  useEffect(() => {
    scrollEvents.subscribe(handleHide)
    window.addEventListener('resize', handleHide)
    return () => {
      window.removeEventListener('resize', handleHide)
    }

    function handleHide() {
      props.editor.sideMenu.unfreezeMenu()
      setShow(false)
    }
  }, [])

  const getReferenceClientRect = useMemo(
    () => {
      if (!referencePos.current) {
        return undefined
      }

      return () => referencePos.current!
    },
    [referencePos.current], // eslint-disable-line
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
        blockDragStart={props.editor.sideMenu.blockDragStart}
        blockDragEnd={props.editor.sideMenu.blockDragEnd}
        addBlock={props.editor.sideMenu.addBlock}
        freezeMenu={props.editor.sideMenu.freezeMenu}
        unfreezeMenu={props.editor.sideMenu.unfreezeMenu}
      />
    )
  }, [block, props.editor, props.sideMenu])

  let topOffset = useMemo(() => {
    if (block && referencePos.current) {
      let lhValue = parseInt(lh, 10)
      // blockContent has padding: 3px 0 (symmetric).
      // First line center = paddingTop + lineHeight/2 from top of blockContent.
      // Tippy centers on the reference, so offset = firstLineCenter - height/2.
      const paddingTop = 3

      return -(referencePos.current.height / 2) + lhValue / 2 + paddingTop
    } else {
      return 0
    }
  }, [referencePos.current])

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
    <Tippy
      appendTo={props.editor.domElement.parentElement ?? document.body}
      content={sideMenuElement}
      getReferenceClientRect={getReferenceClientRect}
      interactive={true}
      visible={show}
      animation={'fade'}
      offset={[topOffset, rightOffset]}
      placement={props.placement}
      popperOptions={popperOptions}
    />
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
