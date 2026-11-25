import {selectableNodeTypes} from '../../../extensions/BlockManipulation/BlockManipulationExtension'
import {Fragment, Node, Slice} from 'prosemirror-model'
import {EditorState, NodeSelection, TextSelection, Transaction} from 'prosemirror-state'
import {ReplaceAroundStep} from 'prosemirror-transform'
import {BlockInfo, getBlockInfoFromResolvedPos} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'

export const getParentBlockInfo = (doc: Node, beforePos: number) => {
  const $pos = doc.resolve(beforePos)

  if ($pos.depth <= 1) {
    return undefined
  }

  // Get the start position of the parent
  const parentBeforePos = $pos.posAtIndex($pos.index($pos.depth - 1), $pos.depth - 1)

  const parentBlockInfo = getBlockInfoFromResolvedPos(doc.resolve(parentBeforePos))
  return parentBlockInfo
}

/**
 * Returns the block info from the sibling block before (above) the given block,
 * or undefined if the given block is the first sibling.
 */
export const getPrevBlockInfo = (doc: Node, beforePos: number) => {
  const $pos = doc.resolve(beforePos)

  const indexInParent = $pos.index()

  if (indexInParent === 0) {
    return undefined
  }

  const prevBlockBeforePos = $pos.posAtIndex(indexInParent - 1)

  const prevBlockInfo = getBlockInfoFromResolvedPos(doc.resolve(prevBlockBeforePos))
  return prevBlockInfo
}

/**
 * If a block has children like this:
 * A
 * - B
 * - C
 * -- D
 *
 * Then the bottom nested block returned is D.
 */
export const getBottomNestedBlockInfo = (doc: Node, blockInfo: BlockInfo) => {
  while (blockInfo.childContainer) {
    const group = blockInfo.childContainer.node

    const newPos = doc.resolve(blockInfo.childContainer.beforePos + 1).posAtIndex(group.childCount - 1)
    blockInfo = getBlockInfoFromResolvedPos(doc.resolve(newPos))
  }

  return blockInfo
}

/**
 * Removes the block at `blockPos` while re-homing its children under the
 * nearest block above, instead of flattening them into siblings.
 *
 * The children group is placed by walking the last-child chain from the block
 * at `prevSiblingPos` (the removed block's previous sibling): the first
 * children group with the same `listType` adopts the removed group's items
 * appended at its end; if no group matches, the bottom-most block of the chain
 * adopts the removed children group as-is. When `mergeContent` is true, the
 * removed block's inline content is appended to that bottom-most block's
 * content.
 *
 * The whole change is a single `ReplaceAroundStep` so that moved children keep
 * their mapped positions (and therefore their `revision` attribute); the slice
 * copies the last-child path, open on the left down to the bottom block's
 * content and closed on the right. Returns the junction position: the end of
 * the bottom-most block's original content, which is where a merged cursor
 * should land.
 */
export const removeBlockKeepingChildren = (
  tr: Transaction,
  prevSiblingPos: number,
  blockPos: number,
  mergeContent: boolean,
): number => {
  const doc = tr.doc
  const block = doc.nodeAt(blockPos)!
  const blockContent = block.firstChild!
  const childrenGroup = block.lastChild!
  const groupBefore = blockPos + 1 + blockContent.nodeSize
  const groupAfter = groupBefore + childrenGroup.nodeSize

  const path: {node: Node; pos: number}[] = []
  let node = doc.nodeAt(prevSiblingPos)!
  let pos = prevSiblingPos
  let appendAt = -1
  while (true) {
    path.push({node, pos})
    if (node.childCount < 2) break
    const group = node.lastChild!
    const groupPos = pos + 1 + node.firstChild!.nodeSize
    path.push({node: group, pos: groupPos})
    if (appendAt < 0 && group.attrs.listType === childrenGroup.attrs.listType) appendAt = path.length - 1
    const last = group.lastChild!
    node = last
    pos = groupPos + group.nodeSize - 1 - last.nodeSize
  }

  const bottom = path[path.length - 1]!
  const bottomContent = bottom.node.firstChild!
  const mergedContent =
    mergeContent && !bottomContent.isLeaf
      ? bottomContent.copy(bottomContent.content.append(blockContent.content))
      : bottomContent

  let inner = Fragment.from(bottom.node.copy(Fragment.from(mergedContent)))
  for (let i = path.length - 2; i >= 0; i--) inner = Fragment.from(path[i]!.node.copy(inner))
  const depth = path.length
  const slice = new Slice(inner, depth, 0)
  const insert = appendAt < 0 ? mergedContent.nodeSize : mergedContent.nodeSize + (depth - 1 - appendAt)
  const [gapFrom, gapTo] = appendAt < 0 ? [groupBefore, groupAfter] : [groupBefore + 1, groupAfter - 1]

  tr.step(new ReplaceAroundStep(bottom.pos + 1, blockPos + block.nodeSize, gapFrom, gapTo, slice, insert, false))

  return bottom.pos + 2 + (bottomContent.isLeaf ? 0 : bottomContent.content.size)
}

const canMerge = (prevBlockInfo: BlockInfo, nextBlockInfo: BlockInfo) => {
  return (
    prevBlockInfo.blockContent.node.type.spec.content === 'inline*' &&
    // prevBlockInfo.blockContent.node.childCount > 0 &&
    nextBlockInfo.blockContent.node.type.spec.content === 'inline*'
  )
}

const mergeBlocks = (
  state: EditorState,
  dispatch: ((args?: any) => any) | undefined,
  prevBlockInfo: BlockInfo,
  nextBlockInfo: BlockInfo,
  prevSiblingInfo: BlockInfo,
) => {
  if (selectableNodeTypes.includes(nextBlockInfo.blockContentType)) {
    if (!prevBlockInfo.blockContent.node.textContent) {
      if (dispatch) {
        const tr = state.tr
        tr.replaceRangeWith(prevBlockInfo.block.beforePos, nextBlockInfo.block.afterPos - 1, nextBlockInfo.block.node)
        tr.setSelection(new NodeSelection(tr.doc.resolve(prevBlockInfo.block.beforePos + 1)))
        dispatch(tr)
      }
      return true
    }
  }

  if (nextBlockInfo.childContainer) {
    if (dispatch) {
      const junction = removeBlockKeepingChildren(
        state.tr,
        prevSiblingInfo.block.beforePos,
        nextBlockInfo.block.beforePos,
        true,
      )
      state.tr.setSelection(TextSelection.near(state.tr.doc.resolve(junction)))
      dispatch(state.tr)
    }

    return true
  }

  // Delete the boundary between the two blocks. Can be thought of as
  // removing the closing tags of the first block and the opening tags of the
  // second one to stitch them together.
  if (dispatch) {
    dispatch(state.tr.delete(prevBlockInfo.blockContent.afterPos - 1, nextBlockInfo.blockContent.beforePos + 1))
  }

  return true
}

export const mergeBlocksCommand =
  (posBetweenBlocks: number) =>
  ({state, dispatch}: {state: EditorState; dispatch: ((args?: any) => any) | undefined}) => {
    const $pos = state.doc.resolve(posBetweenBlocks)
    const nextBlockInfo = getBlockInfoFromResolvedPos($pos)

    const prevBlockInfo = getPrevBlockInfo(state.doc, nextBlockInfo.block.beforePos)

    if (!prevBlockInfo) {
      return false
    }

    const bottomNestedBlockInfo = getBottomNestedBlockInfo(state.doc, prevBlockInfo)

    if (!canMerge(bottomNestedBlockInfo, nextBlockInfo)) {
      return false
    }

    return mergeBlocks(state, dispatch, bottomNestedBlockInfo, nextBlockInfo, prevBlockInfo)
  }
