import {Node} from 'prosemirror-model'
import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {Block, BlockIdentifier, BlockSchema, PartialBlock} from '../../../extensions/Blocks/api/blockTypes'
import {blockToNode, nodeToBlock} from '../../nodeConversions/nodeConversions'
import {getNodeById} from '../../util/nodeUtil'

export function insertBlocks<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blocksToInsert: PartialBlock<BSchema>[],
  referenceBlock: BlockIdentifier,
  placement: 'before' | 'after' | 'nested' = 'before',
): Block<BSchema>[] {
  const id = typeof referenceBlock === 'string' ? referenceBlock : referenceBlock.id

  // Drop orphan table rows and table columns.
  // These block types can only exist nested inside a table block.
  const filteredBlocks = blocksToInsert.filter((b) => {
    if (b.type === 'tableRow' || b.type === 'tableColumn') {
      console.warn(`[insertBlocks] dropping orphan ${String(b.type)} block`, (b as any).id)
      return false
    }
    return true
  })

  const nodesToInsert: Node[] = []
  for (const blockSpec of filteredBlocks) {
    nodesToInsert.push(blockToNode(blockSpec, editor._tiptapEditor.schema))
  }

  const posInfo = getNodeById(id, editor._tiptapEditor.state.doc)
  if (!posInfo) {
    throw new Error(`Block with ID ${id} not found`)
  }

  // TODO: we might want to use the ReplaceStep directly here instead of insert,
  // because the fitting algorithm should not be necessary and might even cause unexpected behavior
  if (placement === 'before') {
    editor.dispatch(editor._tiptapEditor.state.tr.insert(posInfo.posBeforeNode, nodesToInsert))
  }

  if (placement === 'after') {
    editor.dispatch(editor._tiptapEditor.state.tr.insert(posInfo.posBeforeNode + posInfo.node.nodeSize, nodesToInsert))
  }

  // Now that the `PartialBlock`s have been converted to nodes, we can
  // re-convert them into full `Block`s.
  const insertedBlocks: Block<BSchema>[] = []
  for (const node of nodesToInsert) {
    insertedBlocks.push(nodeToBlock(node, editor.schema, editor.blockCache))
  }

  return insertedBlocks
}
