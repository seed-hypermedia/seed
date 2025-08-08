import {Node} from 'prosemirror-model'
import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {
  Block,
  BlockIdentifier,
  BlockSchema,
  PartialBlock,
} from '../../../extensions/Blocks/api/blockTypes'
import {blockToNode, nodeToBlock} from '../../nodeConversions/nodeConversions'

export function removeAndInsertBlocks<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blocksToRemove: BlockIdentifier[],
  blocksToInsert: PartialBlock<BSchema>[],
): {
  insertedBlocks: Block<BSchema>[]
  removedBlocks: Block<BSchema>[]
} {
  const ttEditor = editor._tiptapEditor
  let tr = ttEditor.state.tr

  // Converts the `PartialBlock`s to ProseMirror nodes to insert them into the
  // document.
  const nodesToInsert: Node[] = []
  for (const block of blocksToInsert) {
    nodesToInsert.push(blockToNode(block, editor._tiptapEditor.schema))
  }

  const idsOfBlocksToRemove = new Set<string>(
    blocksToRemove.map((block) =>
      typeof block === 'string' ? block : block.id,
    ),
  )
  const removedBlocks: Block<BSchema>[] = []

  const idOfFirstBlock =
    typeof blocksToRemove[0] === 'string'
      ? blocksToRemove[0]
      // @ts-ignore
      : blocksToRemove[0].id
  let removedSize = 0

  // @ts-ignore
  ttEditor.state.doc.descendants((node, pos) => {
    // Skips traversing nodes after all target blocks have been removed.
    if (idsOfBlocksToRemove.size === 0) {
      return false
    }

    // Keeps traversing nodes if block with target ID has not been found.
    if (
      !node.type.isInGroup('block') ||
      !idsOfBlocksToRemove.has(node.attrs.id)
    ) {
      return true
    }

    // Saves the block that is being deleted.
    removedBlocks.push(nodeToBlock(node, editor.schema, editor.blockCache))
    idsOfBlocksToRemove.delete(node.attrs.id)

    if (blocksToInsert.length > 0 && node.attrs.id === idOfFirstBlock) {
      const oldDocSize = tr.doc.nodeSize
      tr = tr.insert(pos, nodesToInsert)
      const newDocSize = tr.doc.nodeSize

      removedSize += oldDocSize - newDocSize
    }

    const oldDocSize = tr.doc.nodeSize
    // Checks if the block is the only child of its parent. In this case, we
    // need to delete the parent `blockGroup` node instead of just the
    // `blockContainer`.
    const $pos = tr.doc.resolve(pos - removedSize)
    if (
      $pos.node().type.name === 'blockGroup' &&
      $pos.node($pos.depth - 1).type.name !== 'doc' &&
      $pos.node().childCount === 1
    ) {
      tr = tr.delete($pos.before(), $pos.after())
    } else {
      tr = tr.delete(pos - removedSize, pos - removedSize + node.nodeSize)
    }
    const newDocSize = tr.doc.nodeSize
    removedSize += oldDocSize - newDocSize

    return false
  })

  // Throws an error if not all blocks could be found.
  if (idsOfBlocksToRemove.size > 0) {
// @ts-ignore
    const notFoundIds = [...idsOfBlocksToRemove].join('\n')

    throw Error(
      'Blocks with the following IDs could not be found in the editor: ' +
        notFoundIds,
    )
  }

  editor.dispatch(tr)

  // Converts the nodes created from `blocksToInsert` into full `Block`s.
  const insertedBlocks: Block<BSchema>[] = []
  for (const node of nodesToInsert) {
    insertedBlocks.push(nodeToBlock(node, editor.schema, editor.blockCache))
  }

  return {insertedBlocks, removedBlocks}
}

export function newReplaceBlocks<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blocksToRemove: BlockIdentifier[],
  blocksToInsert: PartialBlock<BSchema>[],
): {
  insertedBlocks: Block<BSchema>[]
  removedBlocks: Block<BSchema>[]
} {
  return removeAndInsertBlocks(editor, blocksToRemove, blocksToInsert)
}
