import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {Node} from '@tiptap/pm/model'
import {EditorView} from '@tiptap/pm/view'
import {NodeSelection, Selection, TextSelection} from 'prosemirror-state'
import {BlockNoteEditor, getBlockInfoFromPos} from './blocknote'
import {updateGroupCommand} from './blocknote/core/api/blockManipulation/commands/updateGroup'
import {getNodeById} from './blocknote/core/api/util/nodeUtil'
import {getBlockInfo, getNearestBlockPos} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {HMBlockSchema} from './schema'

/**
 * Put a NodeSelection on the block with the given id in the CURRENT editor
 * document, then focus the view. Resolves the position fresh from the live
 * doc so it is safe to call after transactions that moved/replaced content.
 * Returns true if a matching block was found and selected.
 */
export function selectBlockNodeById(
  editor: BlockNoteEditor<HMBlockSchema>,
  blockId: string,
  opts?: {
    /**
     * Focus the editor view after selecting (default). Pass false when the
     * selection accompanies focus that must stay elsewhere — e.g. selecting
     * a draft card because the user focused its title input.
     */
    focus?: boolean
  },
): boolean {
  const view = editor._tiptapEditor?.view
  const doc = view?.state?.doc
  if (!view || !doc) return false
  let found = false
  doc.descendants((node: Node, pos: number) => {
    if (found) return false
    if (node.type.name === 'blockNode' && node.attrs?.id === blockId) {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos + 1)))
      found = true
      return false
    }
    return true
  })
  if (found && opts?.focus !== false) view.focus()
  return found
}

/**
 * Where the range ends on its target. upHead is the range's end when
 * the target comes first and downHead when it comes after.
 */
type RangeTarget = {pos: number; upHead: number; downHead: number}

// Extends selection to target in reading order, excluding nested children.
function extendSelectionInReadingOrder(doc: Node, selection: Selection, target: RangeTarget): TextSelection | null {
  // A selected card, or a range made by an earlier shift-click, extends from a whole block.
  const fromText = !(selection instanceof NodeSelection) && selection.$anchor.parent.inlineContent
  // The innermost block, for example a card in a grid or nested list rather than its outer block.
  const anchorBlock = fromText ? null : getBlockInfo(getNearestBlockPos(doc, selection.anchor))
  if (anchorBlock?.block.beforePos === target.pos) return null

  const upwards = target.pos < (anchorBlock ? anchorBlock.block.beforePos : selection.anchor)
  const anchor = !anchorBlock
    ? selection.anchor
    : upwards
      ? anchorBlock.blockContent.afterPos
      : anchorBlock.block.beforePos + 1
  return TextSelection.create(doc, anchor, upwards ? target.upHead : target.downHead)
}

// Extends selection to the block with the given id, in reading order.
export function extendSelectionToBlock(editor: BlockNoteEditor<HMBlockSchema>, blockId: string): boolean {
  const view = editor._tiptapEditor?.view
  if (!view) return false
  const {block, blockContent} = getBlockInfo(getNodeById(blockId, view.state.doc))
  const target = {pos: block.beforePos, upHead: block.beforePos + 1, downHead: blockContent.afterPos}
  const extended = extendSelectionInReadingOrder(view.state.doc, view.state.selection, target)
  if (!extended) return selectBlockNodeById(editor, blockId)
  view.dispatch(view.state.tr.setSelection(extended).scrollIntoView())
  view.focus()
  return true
}

// Extends a selection that starts at a whole block, to a position in text.
export function extendBlockSelectionToText(view: EditorView, pos: number): boolean {
  const {selection, doc} = view.state
  if (!(selection instanceof NodeSelection) && selection.$anchor.parent.inlineContent) return false
  const extended = extendSelectionInReadingOrder(doc, selection, {pos, upHead: pos, downHead: pos})
  if (!extended) return false
  view.dispatch(view.state.tr.setSelection(extended))
  view.focus()
  return true
}

export function updateGroup(editor: BlockNoteEditor<HMBlockSchema>, block: any, listType: HMBlockChildrenType) {
  let {posBeforeNode} = getNodeById(block.id, editor._tiptapEditor.state.doc)

  const posData = getBlockInfoFromPos(editor._tiptapEditor.state, posBeforeNode + 1)

  if (!posData) return

  editor.focus()
  editor._tiptapEditor.commands.command(
    updateGroupCommand(posData.block.beforePos + 2, listType, false, undefined, true),
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
    state.doc.nodesBetween(blockInfo.block.beforePos + 1, blockInfo.block.afterPos - 1, (node, pos) => {
      if (node.attrs.id === blockInfo.childContainer!.node.firstChild?.attrs.id) {
        nextBlock = node
        nextBlockPos = pos
      }
    })
  }
  const nextBlockInfo = getBlockInfoFromPos(state, blockInfo.blockContent.afterPos + 3)
  // If there is first child, return it as a next block
  if (nextBlock && nextBlockPos) {
    if (!nextBlockInfo || nextBlockPos <= nextBlockInfo.block.beforePos)
      return {
        nextBlock,
        nextBlockPos,
      }
  }
  if (!nextBlockInfo || nextBlockInfo.block.beforePos + 1 < currentPos) return undefined
  return {
    nextBlock: nextBlockInfo.block.node,
    nextBlockPos: nextBlockInfo.block.beforePos,
  }
}

// Find the previous block from provided position or from selection
// @ts-ignore
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
    state.doc.nodesBetween(prevBlockInfo.block.beforePos + 4, blockInfo.block.beforePos - 1, (node, pos) => {
      if (node.type.name === 'blockNode') {
        prevBlock = node
        prevBlockPos = pos
      }
    })
  }
  if (prevBlock && prevBlockPos) return {prevBlock, prevBlockPos}
}
