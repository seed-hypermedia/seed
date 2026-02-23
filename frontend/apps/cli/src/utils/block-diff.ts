/**
 * Block diffing utilities for --replace-body.
 *
 * Computes minimal document operations by comparing existing document
 * blocks with new blocks parsed from Markdown. Uses positional matching
 * by block type to preserve block IDs where possible.
 */

import type {DocumentOperation} from './signing'
import type {BlockNode, SeedBlock} from './markdown'

// ── Types matching the API response shape ────────────────────────────────────

export type APIBlockNode = {
  block: APIBlock
  children: APIBlockNode[]
}

export type APIBlock = {
  id: string
  type: string
  text: string
  link: string
  annotations: unknown[]
  attributes: Record<string, unknown>
  revision?: string
}

type BlocksMapItem = {
  parent: string
  left: string
  block: APIBlock
}

type BlocksMap = Record<string, BlocksMapItem>

// ── Build a flat map of existing blocks keyed by ID ──────────────────────────

export function createBlocksMap(nodes: APIBlockNode[], parentId: string = ''): BlocksMap {
  const result: BlocksMap = {}

  nodes.forEach((node, idx) => {
    if (!node.block?.id) return

    const prev = idx > 0 ? nodes[idx - 1] : undefined
    const prevId = prev?.block?.id || ''

    result[node.block.id] = {
      parent: parentId,
      left: prevId,
      block: node.block,
    }

    if (node.children?.length) {
      Object.assign(result, createBlocksMap(node.children, node.block.id))
    }
  })

  return result
}

// ── Positional matching: assign existing IDs to new blocks ───────────────────

/**
 * Walk old and new block trees in parallel. When the new block at
 * position N has the same type as the old block at position N, reuse
 * the old block's ID. Otherwise assign the new block's generated ID.
 *
 * Returns a new tree with IDs reassigned (does not mutate inputs).
 */
export function matchBlockIds(oldNodes: APIBlockNode[], newNodes: BlockNode[]): BlockNode[] {
  return newNodes.map((newNode, idx) => {
    const oldNode = idx < oldNodes.length ? oldNodes[idx] : undefined

    let matchedId = newNode.block.id
    if (oldNode && oldNode.block.type === newNode.block.type) {
      matchedId = oldNode.block.id
    }

    const matchedChildren = matchBlockIds(oldNode?.children ?? [], newNode.children)

    return {
      block: {...newNode.block, id: matchedId},
      children: matchedChildren,
    }
  })
}

// ── Compute minimal operations from matched tree ─────────────────────────────

/**
 * Compare the matched new tree against the old blocks map and produce
 * the minimal set of DocumentOperations:
 *
 * - ReplaceBlock for new or content-changed blocks
 * - MoveBlocks for positioning (new blocks or position changes)
 * - DeleteBlocks for blocks removed from the document
 */
export function computeReplaceOps(
  oldMap: BlocksMap,
  matchedTree: BlockNode[],
  parentId: string = '',
): DocumentOperation[] {
  const ops: DocumentOperation[] = []
  const touchedIds = new Set<string>()
  const blockIdsAtLevel: string[] = []

  matchedTree.forEach((node, idx) => {
    const blockId = node.block.id
    touchedIds.add(blockId)
    blockIdsAtLevel.push(blockId)

    const oldEntry = oldMap[blockId]
    const isNew = !oldEntry

    // Build the block object for ReplaceBlock
    const block: Record<string, unknown> = {
      type: node.block.type,
      id: blockId,
      text: node.block.text,
      annotations: node.block.annotations,
    }
    if (node.block.language !== undefined) {
      block.language = node.block.language
    }
    if (node.block.childrenType !== undefined) {
      block.childrenType = node.block.childrenType
    }

    if (isNew) {
      // New block: need both ReplaceBlock and MoveBlocks
      ops.push({type: 'ReplaceBlock', block})
    } else {
      // Existing block: only ReplaceBlock if content changed
      if (!isBlockContentEqual(oldEntry.block, node.block)) {
        ops.push({type: 'ReplaceBlock', block})
      }

      // Check if position changed
      const prevNode = idx > 0 ? matchedTree[idx - 1] : undefined
      const expectedLeft = prevNode?.block.id ?? ''
      if (oldEntry.parent !== parentId || oldEntry.left !== expectedLeft) {
        // Position changed — will be handled by the MoveBlocks below
      }
    }

    // Recurse into children
    if (node.children.length > 0) {
      const childOps = computeReplaceOps(oldMap, node.children, blockId)
      ops.push(...childOps)

      // Collect touched IDs from children
      collectIds(node.children, touchedIds)
    }
  })

  // Emit a single MoveBlocks for all blocks at this level.
  // This positions them correctly under the parent in order.
  // We always emit this to ensure correct ordering after changes.
  if (blockIdsAtLevel.length > 0) {
    ops.push({
      type: 'MoveBlocks',
      blocks: blockIdsAtLevel,
      parent: parentId,
    })
  }

  // DeleteBlocks for old blocks under this parent that are no longer present
  const deletedIds: string[] = []
  for (const [id, entry] of Object.entries(oldMap)) {
    if (entry.parent === parentId && !touchedIds.has(id)) {
      deletedIds.push(id)
    }
  }
  if (deletedIds.length > 0) {
    ops.push({type: 'DeleteBlocks', blocks: deletedIds})
  }

  return ops
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function collectIds(nodes: BlockNode[], set: Set<string>) {
  for (const node of nodes) {
    set.add(node.block.id)
    collectIds(node.children, set)
  }
}

/**
 * Compare old API block content with new parsed block content.
 * Returns true if they're semantically equal.
 */
function isBlockContentEqual(old: APIBlock, newBlock: SeedBlock): boolean {
  if (old.type !== newBlock.type) return false
  if ((old.text || '') !== (newBlock.text || '')) return false

  // Compare annotations
  const oldAnn = old.annotations || []
  const newAnn = newBlock.annotations || []
  if (oldAnn.length !== newAnn.length) return false
  if (oldAnn.length > 0 && JSON.stringify(oldAnn) !== JSON.stringify(newAnn)) {
    return false
  }

  // Compare relevant attributes
  const oldAttrs = old.attributes || {}
  if ((oldAttrs.childrenType || '') !== (newBlock.childrenType || '')) {
    return false
  }
  if ((oldAttrs.language || '') !== (newBlock.language || '')) return false

  return true
}
