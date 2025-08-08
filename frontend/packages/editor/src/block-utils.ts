import {HMBlockChildrenType} from '@shm/shared/hm-types'
import {Node} from '@tiptap/pm/model'
import {EditorView} from '@tiptap/pm/view'
import {BlockNoteEditor, getBlockInfoFromPos} from './blocknote'
import {updateGroupCommand} from './blocknote/core/api/blockManipulation/commands/updateGroup'
import {getNodeById} from './blocknote/core/api/util/nodeUtil'
import {HMBlockSchema} from './schema'

export function updateGroup(
  editor: BlockNoteEditor<HMBlockSchema>,
  block: any,
  listType: HMBlockChildrenType,
) {
  let {posBeforeNode} = getNodeById(block.id, editor._tiptapEditor.state.doc)

  const posData = getBlockInfoFromPos(
    editor._tiptapEditor.state,
    posBeforeNode + 1,
  )

  if (!posData) return

  editor.focus()
  editor._tiptapEditor.commands.command(
    updateGroupCommand(
      posData.block.beforePos + 2,
      listType,
      false,
      undefined,
      true,
    ),
  )
}

// Find the next block from provided position or from selection
export function findNextBlock(view: EditorView, pos?: number) {
  const {state} = view
  const currentPos = pos ? pos : state.selection.from
  const blockInfo = getBlockInfoFromPos(state, currentPos)!
  let nextBlock: Node | undefined
  let nextBlockPos: number | undefined
  // Find first child
  if (blockInfo.childContainer) {
    state.doc.nodesBetween(
      blockInfo.block.beforePos + 1,
      blockInfo.block.afterPos - 1,
      (node, pos) => {
        if (
          node.attrs.id === blockInfo.childContainer!.node.firstChild?.attrs.id
        ) {
          nextBlock = node
          nextBlockPos = pos
        }
      },
    )
  }
  const nextBlockInfo = getBlockInfoFromPos(
    state,
    blockInfo.blockContent.afterPos + 3,
  )
  // If there is first child, return it as a next block
  if (nextBlock && nextBlockPos) {
    if (!nextBlockInfo || nextBlockPos <= nextBlockInfo.block.beforePos)
      return {
        nextBlock,
        nextBlockPos,
      }
  }
  if (!nextBlockInfo || nextBlockInfo.block.beforePos + 1 < currentPos)
    return undefined
  return {
    nextBlock: nextBlockInfo.block.node,
    nextBlockPos: nextBlockInfo.block.beforePos,
  }
}

// Find the previous block from provided position or from selection
// @ts-expect-error
export function findPreviousBlock(view: EditorView, pos?: number) {
  const {state} = view
  const currentPos = pos ? pos : state.selection.from
  const $currentPos = state.doc.resolve(currentPos)
  if ($currentPos.start() <= 3) return undefined
  const blockInfo = getBlockInfoFromPos(state, currentPos)!
  const prevBlockInfo = getBlockInfoFromPos(state, $currentPos.start() - 3)
  // If prev block has no children, return it
  if (prevBlockInfo.block.node.childCount === 1)
    return {
      prevBlock: prevBlockInfo.block.node,
      prevBlockPos: prevBlockInfo.block.beforePos,
    }
  let prevBlock: Node | undefined
  let prevBlockPos: number | undefined
  // Find last child of prev block and return it
  if (prevBlockInfo.childContainer) {
    state.doc.nodesBetween(
      prevBlockInfo.block.beforePos + 4,
      blockInfo.block.beforePos - 1,
      (node, pos) => {
        if (node.type.name === 'blockContainer') {
          prevBlock = node
          prevBlockPos = pos
        }
      },
    )
  }
  if (prevBlock && prevBlockPos) return {prevBlock, prevBlockPos}
}
