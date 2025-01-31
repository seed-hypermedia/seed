import {ResolvedPos} from '@tiptap/pm/model'
import {Node} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'

type SingleBlockInfo = {
  node: Node
  beforePos: number
  afterPos: number
}

export type BlockInfo = {
  /**
   * The outer node that represents a BlockNote block. This is the node that has the ID.
   * It will be of type BlockContainer.
   */
  block: SingleBlockInfo
  /**
   * The type of BlockNote block that this node represents.
   * When dealing with a blockContainer, this is retrieved from the blockContent node, otherwise it's retrieved from the block node.
   */
  blockContentType: string
  /**
   * The Prosemirror node that holds block.children. For blockContainers, this is the blockGroup node, if it exists.
   */
  childContainer?: SingleBlockInfo
  /**
   * The Prosemirror node that wraps block.content and has most of the props
   */
  blockContent: SingleBlockInfo
}

/**
 * Retrieve the position just before the nearest block node in a ProseMirror
 * doc, relative to a position. If the position is within a block node or its
 * descendants, the position just before it is returned. If the position is not
 * within a block node or its descendants, the position just before the next
 * closest block node is returned. If the position is beyond the last block, the
 * position just before the last block is returned.
 * @param doc The ProseMirror doc.
 * @param pos An integer position in the document.
 * @returns The position just before the nearest blockContainer node.
 */
export function getNearestBlockPos(doc: Node, pos: number) {
  const $pos = doc.resolve(pos)

  // Check if the position provided is already just before a block node, in
  // which case we return the position.
  if ($pos.nodeAfter && $pos.nodeAfter.type.isInGroup('block')) {
    return {
      posBeforeNode: $pos.pos,
      node: $pos.nodeAfter,
    }
  }

  // Check the node containing the position and its ancestors until a
  // block node is found and returned.
  let depth = $pos.depth
  let node = $pos.node(depth)
  while (depth > 0) {
    if (node.type.isInGroup('block')) {
      return {
        posBeforeNode: $pos.before(depth),
        node: node,
      }
    }

    depth--
    node = $pos.node(depth)
  }

  // If the position doesn't lie within a block node, find the
  // position of the next closest one. If the position is beyond the last block,
  // return the position of the last block. While running `doc.descendants`
  // is expensive, this case should be very rarely triggered. However, it's
  // possible for the position to sometimes be beyond the last block node. This
  // is a problem specifically when using the collaboration plugin.
  const allBlockContainerPositions: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.isInGroup('block')) {
      allBlockContainerPositions.push(pos)
    }
  })

  // eslint-disable-next-line no-console
  console.warn(`Position ${pos} is not within a blockContainer node.`)

  const resolvedPos = doc.resolve(
    allBlockContainerPositions.find((position) => position >= pos) ||
      allBlockContainerPositions[allBlockContainerPositions.length - 1],
  )
  return {
    posBeforeNode: resolvedPos.pos,
    node: resolvedPos.nodeAfter!,
  }
}

/**
 * Get information regarding the ProseMirror nodes that make up a block in a
 * BlockNote document. This includes the main `blockContainer` node, the
 * `blockContent` node with the block's main body, and the optional `blockGroup`
 * node which contains the block's children. As well as the nodes, also returns
 * the ProseMirror positions just before & after each node.
 * @param node The main `blockContainer` node that the block information should
 * be retrieved from,
 * @param blockBeforePosOffset the position just before the
 * `blockContainer` node in the document.
 */
export function getBlockInfoWithManualOffset(
  node: Node,
  blockBeforePosOffset: number,
): BlockInfo {
  if (!node.type.isInGroup('block')) {
    throw new Error(
      `Attempted to get block node at position but found node of different type ${node.type}`,
    )
  }

  const blockNode = node
  const blockBeforePos = blockBeforePosOffset
  const blockAfterPos = blockBeforePos + blockNode.nodeSize

  const block: SingleBlockInfo = {
    node: blockNode,
    beforePos: blockBeforePos,
    afterPos: blockAfterPos,
  }

  let blockContent: SingleBlockInfo | undefined
  let blockGroup: SingleBlockInfo | undefined

  blockNode.forEach((node, offset) => {
    if (node.type.spec.group === 'blockContent') {
      const blockContentNode = node
      const blockContentBeforePos = blockBeforePos + offset + 1
      const blockContentAfterPos = blockContentBeforePos + node.nodeSize

      blockContent = {
        node: blockContentNode,
        beforePos: blockContentBeforePos,
        afterPos: blockContentAfterPos,
      }
    } else if (node.type.name === 'blockGroup') {
      const blockGroupNode = node
      const blockGroupBeforePos = blockBeforePos + offset + 1
      const blockGroupAfterPos = blockGroupBeforePos + node.nodeSize

      blockGroup = {
        node: blockGroupNode,
        beforePos: blockGroupBeforePos,
        afterPos: blockGroupAfterPos,
      }
    }
  })

  if (!blockContent) {
    throw new Error(
      `blockContainer node does not contain a blockContent node in its children: ${blockNode}`,
    )
  }

  return {
    block,
    blockContent,
    childContainer: blockGroup,
    blockContentType: blockContent.node.type.name,
  }
}

/**
 * Get information regarding the ProseMirror nodes that make up a block in a
 * BlockNote document. This includes the main `blockContainer` node, the
 * `blockContent` node with the block's main body, and the optional `blockGroup`
 * node which contains the block's children. As well as the nodes, also returns
 * the ProseMirror positions just before & after each node.
 * @param posInfo An object with the main `blockContainer` node that the block
 * information should be retrieved from, and the position just before it in the
 * document.
 */
export function getBlockInfo(posInfo: {posBeforeNode: number; node: Node}) {
  return getBlockInfoWithManualOffset(posInfo.node, posInfo.posBeforeNode)
}

/**
 * Get information regarding the ProseMirror nodes that make up a block from a
 * resolved position just before the `blockContainer` node in the document that
 * corresponds to it.
 * @param resolvedPos The resolved position just before the `blockContainer`
 * node.
 */
export function getBlockInfoFromResolvedPos(resolvedPos: ResolvedPos) {
  if (!resolvedPos.nodeAfter) {
    throw new Error(
      `Attempted to get blockContainer node at position ${resolvedPos.pos} but a node at this position does not exist`,
    )
  }
  return getBlockInfoWithManualOffset(resolvedPos.nodeAfter, resolvedPos.pos)
}

/**
 * Get information regarding the ProseMirror nodes that make up a block. The
 * block chosen is the one currently containing the current ProseMirror
 * selection.
 * @param state The ProseMirror editor state.
 */
export function getBlockInfoFromSelection(state: EditorState) {
  const posInfo = getNearestBlockPos(state.doc, state.selection.anchor)

  return getBlockInfo(posInfo)
}

/**
 * Get block information from a provided numeric position.
 * @param state The ProseMirror editor state.
 * @param pos The numeric position that is within the node's boundaries.
 */
export function getBlockInfoFromPos(state: EditorState, pos: number) {
  const posInfo = getNearestBlockPos(state.doc, pos)

  return getBlockInfo(posInfo)
}
