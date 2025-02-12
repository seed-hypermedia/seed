import {Node} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {
  BlockInfo,
  getBlockInfoFromResolvedPos,
} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'

export const getParentBlockInfo = (doc: Node, beforePos: number) => {
  const $pos = doc.resolve(beforePos)

  if ($pos.depth <= 1) {
    return undefined
  }

  // Get the start position of the parent
  const parentBeforePos = $pos.posAtIndex(
    $pos.index($pos.depth - 1),
    $pos.depth - 1,
  )

  const parentBlockInfo = getBlockInfoFromResolvedPos(
    doc.resolve(parentBeforePos),
  )
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

  const prevBlockInfo = getBlockInfoFromResolvedPos(
    doc.resolve(prevBlockBeforePos),
  )
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

    const newPos = doc
      .resolve(blockInfo.childContainer.beforePos + 1)
      .posAtIndex(group.childCount - 1)
    blockInfo = getBlockInfoFromResolvedPos(doc.resolve(newPos))
  }

  return blockInfo
}

const canMerge = (prevBlockInfo: BlockInfo, nextBlockInfo: BlockInfo) => {
  console.log(
    prevBlockInfo.blockContent.node.type.spec.content,
    prevBlockInfo.blockContent.node,
    nextBlockInfo.blockContent.node.type.spec.content,
  )
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
) => {
  // Remove a level of nesting all children of the block.
  if (nextBlockInfo.childContainer) {
    const childBlocksStart = state.doc.resolve(
      nextBlockInfo.childContainer.beforePos + 1,
    )
    const childBlocksEnd = state.doc.resolve(
      nextBlockInfo.childContainer.afterPos - 1,
    )
    const childBlocksRange = childBlocksStart.blockRange(childBlocksEnd)

    if (dispatch) {
      const pos = state.doc.resolve(nextBlockInfo.block.beforePos)
      state.tr.lift(childBlocksRange!, pos.depth)
    }
  }

  // Delete the boundary between the two blocks. Can be thought of as
  // removing the closing tags of the first block and the opening tags of the
  // second one to stitch them together.
  if (dispatch) {
    dispatch(
      state.tr.delete(
        prevBlockInfo.blockContent.afterPos - 1,
        nextBlockInfo.blockContent.beforePos + 1,
      ),
    )
  }

  return true
}

export const mergeBlocksCommand =
  (posBetweenBlocks: number) =>
  ({
    state,
    dispatch,
  }: {
    state: EditorState
    dispatch: ((args?: any) => any) | undefined
  }) => {
    const $pos = state.doc.resolve(posBetweenBlocks)
    const nextBlockInfo = getBlockInfoFromResolvedPos($pos)

    const prevBlockInfo = getPrevBlockInfo(
      state.doc,
      nextBlockInfo.block.beforePos,
    )

    if (!prevBlockInfo) {
      return false
    }

    const bottomNestedBlockInfo = getBottomNestedBlockInfo(
      state.doc,
      prevBlockInfo,
    )

    if (!canMerge(bottomNestedBlockInfo, nextBlockInfo)) {
      console.log('here')
      return false
    }

    const result = mergeBlocks(
      state,
      dispatch,
      bottomNestedBlockInfo,
      nextBlockInfo,
    )
    console.log(result)
    return result
  }
