import {Block, BlockNoteEditor, BlockSchema, DefaultBlockSchema, SideMenuProsemirrorPlugin} from '../../../core'
import {getGroupInfoFromPos} from '../../../core/extensions/Blocks/helpers/getGroupInfoFromPos'
import {fullBlockSelectionPluginKey} from '../../../core/extensions/FullBlockSelection/FullBlockSelectionPlugin'
import Tippy from '@tippyjs/react'
import type {Node as PMNode} from 'prosemirror-model'
import {FC, useEffect, useMemo, useRef, useState} from 'react'
import {DefaultSideMenu} from './DefaultSideMenu'
import {DragHandleMenuProps} from './DragHandleMenu/DragHandleMenu'
import {DropIndicator} from './DropIndicator'

/** First id (in document order) among the given block ids. */
function findFirstBlockIdInDocOrder(doc: PMNode, blockIds: string[]): string | undefined {
  if (blockIds.length === 1) return blockIds[0]
  const idSet = new Set(blockIds)
  let firstId: string | undefined
  doc.descendants((node) => {
    if (firstId) return false
    if (node.type.name !== 'blockNode') return true
    const id = node.attrs.id as string | undefined
    if (id && idSet.has(id)) {
      firstId = id
      return false
    }
    return true
  })
  return firstId
}

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
    const editor = props.editor
    // Derive the block tools straight from the FullBlockSelection plugin — the
    // same single selection source that drives the outline, so the two always
    // show for the same block on the same transaction.
    const sync = (blockIds: string[]) => {
      const view = editor._tiptapEditor?.view
      if (!view || !view.editable || blockIds.length === 0) {
        setShow(false)
        return
      }
      const firstId = findFirstBlockIdInDocOrder(view.state.doc, blockIds)
      const blockEl = firstId ? (view.dom.querySelector(`[data-id="${firstId}"]`) as HTMLElement | null) : null
      const blockContent = blockEl?.firstChild as HTMLElement | null
      const selectedBlock = firstId ? editor.getBlock(firstId) : undefined
      if (!blockContent || !selectedBlock) {
        setShow(false)
        return
      }
      const rect = blockContent.getBoundingClientRect()
      referencePos.current = new DOMRect(rect.x, rect.y, rect.width, rect.height)
      setLh(window.getComputedStyle(blockContent).lineHeight)
      setBlock(selectedBlock as Block<BSchema>)
      setShow(true)
    }
    sync(fullBlockSelectionPluginKey.getState(editor._tiptapEditor.state)?.blockIds ?? [])
    const unsubscribe = editor.fullBlockSelection?.onUpdate(({blockIds}) => sync(blockIds))
    return unsubscribe
  }, [props.editor])

  const getReferenceClientRect = useMemo(
    () => {
      if (!referencePos.current || !block) {
        return undefined
      }

      const blockId = block.id
      const editor = props.editor
      // Read the block's CURRENT rect lazily on every popper computation, so
      // the menu follows the block through scrolls and layout changes (popper
      // re-invokes this on ancestor scroll/resize). Visibility stays purely a
      // function of the selection state — scrolling never hides the menu.
      return () => {
        const view = editor._tiptapEditor?.view
        const blockEl = view?.dom.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null
        const blockContent = blockEl?.firstChild instanceof HTMLElement ? blockEl.firstChild : null
        const rect = blockContent?.getBoundingClientRect() ?? referencePos.current!
        // Cover only the first line of the block so Tippy centers the side
        // menu button at the top of the block, not its vertical center.
        const lhValue = parseInt(lh, 10) || 24
        const firstLineHeight = lhValue + 6 // include blockContent padding (3px top + 3px bottom)
        return new DOMRect(rect.x, rect.y, rect.width, firstLineHeight)
      }
    },
    // `block` is a dependency so Tippy repositions when the selection moves to
    // a different block (a new callback identity forces popper to recompute).
    [show, lh, block], // eslint-disable-line
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
  }, [show, block])

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
