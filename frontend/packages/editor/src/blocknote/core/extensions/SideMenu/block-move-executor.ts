/**
 * Translates a DropInstruction into a single ProseMirror transaction.
 *
 * All operations (delete source + insert at target) happen in ONE transaction
 * for Y.js/CRDT atomicity.
 */
import {Fragment, Node, ResolvedPos} from 'prosemirror-model'
import {TextSelection, type Transaction} from 'prosemirror-state'
import type {BlockNoteEditor} from '../../BlockNoteEditor'
import type {BlockSchema} from '../../extensions/Blocks/api/blockTypes'
import {getNodeById} from '../../api/util/nodeUtil'
import type {DropInstruction} from './drag-state'

type NodeInfo = {
  node: Node
  posBeforeNode: number
}

/**
 * Returns true if `candidateAncestorId` is an ancestor of `nodeId` in the doc.
 * Used to prevent dropping a block into its own descendants.
 */
function isAncestorOf(doc: Node, candidateAncestorId: string, nodeId: string): boolean {
  const {posBeforeNode} = getNodeById(candidateAncestorId, doc)
  const ancestorNode = doc.resolve(posBeforeNode).nodeAfter
  if (!ancestorNode) return false

  const endPos = posBeforeNode + ancestorNode.nodeSize
  try {
    const {posBeforeNode: targetPos} = getNodeById(nodeId, doc)
    return targetPos > posBeforeNode && targetPos < endPos
  } catch {
    return false
  }
}

/**
 * Execute a block move based on a DropInstruction.
 * All changes are performed in a single ProseMirror transaction.
 */
export function executeBlockMove<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  sourceBlockIds: string[],
  instruction: DropInstruction,
): void {
  const view = editor.prosemirrorView
  const {state} = view
  const tr = state.tr

  // Guard: prevent dropping into own descendants
  for (const sourceId of sourceBlockIds) {
    if (isAncestorOf(state.doc, sourceId, instruction.targetBlockId)) {
      return
    }
  }

  // Collect source nodes (we need copies before deleting)
  const sourceInfos: NodeInfo[] = sourceBlockIds.map((id) => getNodeById(id, tr.doc))
  const sourceNodes: Node[] = sourceInfos.map((info) => info.node)

  // Calculate the insertion position BEFORE deleting sources
  const insertPos = resolveInsertPosition(tr.doc, instruction, state.schema)
  if (insertPos === null) return

  // Delete source blocks in reverse document order to preserve earlier positions
  const sortedSources = [...sourceInfos].sort((a, b) => b.posBeforeNode - a.posBeforeNode)
  for (const {posBeforeNode, node} of sortedSources) {
    tr.delete(posBeforeNode, posBeforeNode + node.nodeSize)
  }

  // For make-child, re-resolve the target by ID in the post-deletion doc
  // instead of relying on position mapping (which can land on the wrong node)
  if (instruction.type === 'make-child') {
    const {posBeforeNode: targetPos, node: targetNode} = getNodeById(instruction.targetBlockId, tr.doc)
    insertAsChild(tr, targetPos, targetPos + targetNode.nodeSize, sourceNodes, state.schema)
  } else {
    // Map the insertion position through the deletions
    const mappedPos = tr.mapping.map(insertPos)
    tr.insert(mappedPos, Fragment.from(sourceNodes))
  }

  view.dispatch(tr)

  // Restore focus to the first moved block
  const firstBlockId = sourceBlockIds[0]
  requestAnimationFrame(() => {
    try {
      if (!firstBlockId) {
        view.focus()
        return
      }
      const {posBeforeNode} = getNodeById(firstBlockId, view.state.doc)
      // Position cursor at the start of the block's content
      const $pos = view.state.doc.resolve(posBeforeNode + 1)
      const textPos = $pos.nodeAfter ? posBeforeNode + 2 : posBeforeNode + 1
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(textPos))))
      view.focus()
    } catch {
      // Block may not exist (shouldn't happen), just focus
      view.focus()
    }
  })
}

/**
 * Resolves the document position where blocks should be inserted,
 * based on the instruction type and target block.
 */
function resolveInsertPosition(doc: Node, instruction: DropInstruction, _schema: any): number | null {
  const {posBeforeNode, node: targetNode} = getNodeById(instruction.targetBlockId, doc)

  switch (instruction.type) {
    case 'reorder-above':
      return posBeforeNode

    case 'reorder-below':
      return posBeforeNode + targetNode.nodeSize

    case 'make-child':
      // Position after the target block's content node (before potential existing children).
      // We'll handle the wrapper creation in insertAsChild().
      return posBeforeNode + targetNode.nodeSize

    case 'reparent': {
      // Walk up from target to find the ancestor at the desired level,
      // then insert after that ancestor.
      const $pos = doc.resolve(posBeforeNode)
      // Each blockChildren+blockNode pair is 2 depth levels
      // We need to find the right ancestor based on desiredLevel
      const currentLevel = countBlockChildrenAncestors($pos)
      const levelsUp = currentLevel - instruction.desiredLevel

      if (levelsUp <= 0) {
        // Can't reparent to same or deeper level, treat as reorder-below
        return posBeforeNode + targetNode.nodeSize
      }

      // Walk up to find the ancestor blockNode at the desired level
      let depth = $pos.depth
      let levelsFound = 0
      while (depth > 0 && levelsFound < levelsUp) {
        const nodeAtDepth = $pos.node(depth)
        if (nodeAtDepth.type.name === 'blockNode') {
          levelsFound++
          if (levelsFound === levelsUp) {
            // Insert after this ancestor blockNode
            return $pos.after(depth)
          }
        }
        depth--
      }

      // Fallback: insert after target
      return posBeforeNode + targetNode.nodeSize
    }

    case 'grid-before':
      return posBeforeNode

    case 'grid-after':
      return posBeforeNode + targetNode.nodeSize
  }
}

/**
 * Counts the number of blockChildren ancestors for a resolved position.
 */
function countBlockChildrenAncestors(pos: ResolvedPos): number {
  let count = 0
  for (let d = pos.depth; d >= 0; d--) {
    if (pos.node(d).type.name === 'blockChildren') {
      count++
    }
  }
  return count
}

/**
 * Inserts source blocks as children of the target block.
 * Creates a blockChildren wrapper if the target doesn't have one yet.
 *
 * @param targetPos - the resolved posBeforeNode of the target block in tr.doc
 * @param targetEndPos - posBeforeNode + targetNode.nodeSize
 */
function insertAsChild(
  tr: Transaction,
  targetPos: number,
  targetEndPos: number,
  sourceNodes: Node[],
  schema: any,
): void {
  const $pos = tr.doc.resolve(targetPos)
  const targetBlock = $pos.nodeAfter

  if (!targetBlock || targetBlock.type.name !== 'blockNode') {
    // Fallback: just insert after
    tr.insert(targetEndPos, Fragment.from(sourceNodes))
    return
  }

  // Check if the target already has a blockChildren child
  let hasBlockChildren = false
  let blockChildrenOffset = -1
  targetBlock.forEach((child, offset) => {
    if (child.type.name === 'blockChildren') {
      hasBlockChildren = true
      blockChildrenOffset = offset
    }
  })

  if (hasBlockChildren) {
    // Position of blockChildren node in the document
    const blockChildrenPos = targetPos + 1 + blockChildrenOffset
    const blockChildrenNode = tr.doc.nodeAt(blockChildrenPos)!
    // Append at the end of existing blockChildren
    const insertAt = blockChildrenPos + blockChildrenNode.nodeSize - 1
    tr.insert(insertAt, Fragment.from(sourceNodes))
  } else {
    // Create a new blockChildren wrapper and insert it at the end of the blockNode
    const blockChildrenType = schema.nodes.blockChildren
    const wrapper = blockChildrenType.create({listType: 'Group', listLevel: '1'}, Fragment.from(sourceNodes))
    // Insert just before the closing of the blockNode
    const insertAt = targetPos + targetBlock.nodeSize - 1
    tr.insert(insertAt, wrapper)
  }
}
