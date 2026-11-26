import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {Node} from '@tiptap/pm/model'
import {EditorView} from '@tiptap/pm/view'
import {NodeSelection, Selection} from 'prosemirror-state'
import {BlockNoteEditor, getBlockInfoFromPos} from './blocknote'
import {updateGroupCommand} from './blocknote/core/api/blockManipulation/commands/updateGroup'
import {getNodeById} from './blocknote/core/api/util/nodeUtil'
import {selectableNodeTypes} from './blocknote/core/extensions/Blocks/api/selectable-node-types'
import {getBlockInfo, getNearestBlockPos} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {rangeSelectionBetween} from './blocknote/core/extensions/FullBlockSelection/BlockRangeSelection'
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
function extendSelectionInReadingOrder(doc: Node, selection: Selection, target: RangeTarget): Selection | null {
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
  return rangeSelectionBetween(doc.resolve(anchor), doc.resolve(upwards ? target.upHead : target.downHead))
}

/**
 * The offset of the next character boundary in a text block, in the given direction. A character made of several code
 * units, such as an emoji, is stepped over whole, and an inline node such as a mention counts as one character.
 */
export function characterBoundary(textblock: Node, offset: number, forward: boolean): number {
  // One character per inline node, so offsets in the text are offsets in the block.
  const text = textblock.textBetween(0, textblock.content.size, undefined, '￼')
  const starts = Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text), (s) => s.index)
  if (forward) return starts.find((start) => start > offset) ?? text.length
  return starts.filter((start) => start < offset).pop() ?? 0
}

/**
 * The block before or after the given one in reading order, nested blocks included. Slots are passed over: they show
 * nothing of their own, so the next block is the first item of their list.
 */
function adjacentBlock(
  doc: Node,
  posBeforeBlock: number,
  forward: boolean,
): {node: Node; posBeforeNode: number} | null {
  let previous: {node: Node; posBeforeNode: number} | null = null
  let reached = false
  let found: {node: Node; posBeforeNode: number} | null = null
  doc.descendants((node, pos) => {
    if (found || (reached && !forward)) return false
    if (node.type.name !== 'blockNode') return true
    if (pos === posBeforeBlock) {
      reached = true
      if (!forward) found = previous
      return true
    }
    if (node.firstChild?.type.name === 'slot') return true
    if (reached) found = {node, posBeforeNode: pos}
    else previous = {node, posBeforeNode: pos}
    return !found
  })
  return found
}

/** Moves the end of the selection one block in reading order. */
export function extendSelectionByBlock(view: EditorView, forward: boolean, wholeTextBlocks: boolean): boolean {
  const {doc, selection} = view.state
  const headPos = selection instanceof NodeSelection ? selection.from : selection.head
  const next = adjacentBlock(doc, getNearestBlockPos(doc, headPos).posBeforeNode, forward)
  // At the start or end of the document, there's nothing to add.
  if (!next) return true

  const {block, blockContent} = getBlockInfo(next)
  const content = blockContent.node
  const anchorInThisText =
    !(selection instanceof NodeSelection) &&
    selection.$anchor.parent.inlineContent &&
    getNearestBlockPos(doc, selection.anchor).posBeforeNode === block.beforePos
  const whole =
    selectableNodeTypes.includes(content.type.name) || !content.inlineContent || (wholeTextBlocks && !anchorInThisText)
  // Into the text, at its edge facing where the end came from.
  let textEdge = forward ? blockContent.beforePos + 1 : blockContent.afterPos - 1
  // Reaching into the text but stopping at its edge would select none of it and look like no change, so take its
  // first character too.
  const reaching = forward ? textEdge > selection.anchor : textEdge < selection.anchor
  if (!whole && reaching && content.content.size > 0) {
    textEdge = blockContent.beforePos + 1 + characterBoundary(content, forward ? 0 : content.content.size, forward)
  }
  const target = whole
    ? {pos: block.beforePos, upHead: block.beforePos + 1, downHead: blockContent.afterPos}
    : {pos: textEdge, upHead: textEdge, downHead: textEdge}

  // Back at the card the range started on, only that card stays selected.
  const extended =
    extendSelectionInReadingOrder(doc, selection, target) ?? NodeSelection.create(doc, block.beforePos + 1)
  view.dispatch(view.state.tr.setSelection(extended).scrollIntoView())
  return true
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
