import {Node as PMNode} from '@tiptap/pm/model'

/**
 * Returns the BlockNote wrapper node for a ProseMirror position inside a block.
 */
export function getBlockNodeFromPos(doc: PMNode, pos: number): PMNode | undefined {
  const nodeAtPos = doc.nodeAt(pos)
  if (nodeAtPos?.type.name === 'blockNode') return nodeAtPos

  const resolvedPos = doc.resolve(pos)
  for (let depth = resolvedPos.depth; depth >= 0; depth--) {
    const node = resolvedPos.node(depth)
    if (node.type.name === 'blockNode') return node
  }

  return undefined
}
