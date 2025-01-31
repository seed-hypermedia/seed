import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {
  Block,
  BlockIdentifier,
  BlockSchema,
} from '../../../extensions/Blocks/api/blockTypes'
import {nodeToBlock} from '../../nodeConversions/nodeConversions'
import {getNodeById} from '../../util/nodeUtil'

export function getBlock<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blockIdentifier: BlockIdentifier,
): Block<BSchema> | undefined {
  const id =
    typeof blockIdentifier === 'string' ? blockIdentifier : blockIdentifier.id

  const posInfo = getNodeById(id, editor._tiptapEditor.state.doc)
  if (!posInfo) {
    return undefined
  }

  return nodeToBlock(posInfo.node, editor.schema, editor.blockCache)
}

export function getPrevBlock<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blockIdentifier: BlockIdentifier,
): Block<BSchema> | undefined {
  const id =
    typeof blockIdentifier === 'string' ? blockIdentifier : blockIdentifier.id

  const posInfo = getNodeById(id, editor._tiptapEditor.state.doc)
  if (!posInfo) {
    return undefined
  }

  const $posBeforeNode = editor._tiptapEditor.state.doc.resolve(
    posInfo.posBeforeNode,
  )
  const nodeToConvert = $posBeforeNode.nodeBefore
  if (!nodeToConvert) {
    return undefined
  }

  return nodeToBlock(nodeToConvert, editor.schema, editor.blockCache)
}

export function getNextBlock<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blockIdentifier: BlockIdentifier,
): Block<BSchema> | undefined {
  const id =
    typeof blockIdentifier === 'string' ? blockIdentifier : blockIdentifier.id

  const posInfo = getNodeById(id, editor._tiptapEditor.state.doc)
  if (!posInfo) {
    return undefined
  }

  const $posAfterNode = editor._tiptapEditor.state.doc.resolve(
    posInfo.posBeforeNode + posInfo.node.nodeSize,
  )
  const nodeToConvert = $posAfterNode.nodeAfter
  if (!nodeToConvert) {
    return undefined
  }

  return nodeToBlock(nodeToConvert, editor.schema, editor.blockCache)
}

export function getParentBlock<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blockIdentifier: BlockIdentifier,
): Block<BSchema> | undefined {
  const id =
    typeof blockIdentifier === 'string' ? blockIdentifier : blockIdentifier.id

  const posInfo = getNodeById(id, editor._tiptapEditor.state.doc)
  if (!posInfo) {
    return undefined
  }

  const $posBeforeNode = editor._tiptapEditor.state.doc.resolve(
    posInfo.posBeforeNode,
  )
  const parentNode = $posBeforeNode.node()
  const grandparentNode = $posBeforeNode.node(-1)
  const nodeToConvert =
    grandparentNode.type.name !== 'doc'
      ? parentNode.type.name === 'blockGroup'
        ? grandparentNode
        : parentNode
      : undefined
  if (!nodeToConvert) {
    return undefined
  }

  return nodeToBlock(nodeToConvert, editor.schema, editor.blockCache)
}
