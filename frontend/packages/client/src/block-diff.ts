/**
 * Block diffing utilities for document update.
 *
 * Computes minimal document operations by comparing existing document
 * blocks with new blocks parsed from Markdown or JSON input.
 *
 * The primary flow trusts block IDs from the input: if an input block's
 * ID exists in the old document, it's treated as an existing block and
 * diffed for content changes. If the ID doesn't exist, the block is
 * treated as new. Old blocks whose IDs don't appear in the new tree
 * are deleted. This gives per-block granularity — a mix of known and
 * unknown IDs is handled correctly.
 */

import type {DocumentOperation} from './change'
import type {HMBlock, HMBlockNode} from './hm-types'

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
export function matchBlockIds(oldNodes: APIBlockNode[], newNodes: HMBlockNode[]): HMBlockNode[] {
  return newNodes.map((newNode, idx) => {
    const oldNode = idx < oldNodes.length ? oldNodes[idx] : undefined
    const b = newNode.block as Record<string, unknown>

    let matchedId = b.id as string
    if (oldNode && oldNode.block.type === (b.type as string)) {
      matchedId = oldNode.block.id
    }

    const matchedChildren = matchBlockIds(oldNode?.children ?? [], newNode.children || [])

    return {
      block: {...newNode.block, id: matchedId} as HMBlock,
      children: matchedChildren.length > 0 ? matchedChildren : undefined,
    }
  })
}

// ── Compute minimal operations from matched tree ─────────────────────────────

/**
 * Compare the new block tree against the old blocks map and produce
 * the minimal set of DocumentOperations:
 *
 * - ReplaceBlock for new or content-changed blocks
 * - MoveBlocks for positioning (new blocks or position changes)
 * - DeleteBlocks for blocks removed from the document
 */
export function computeReplaceOps(
  oldMap: BlocksMap,
  matchedTree: HMBlockNode[],
  parentId: string = '',
): DocumentOperation[] {
  const ops: DocumentOperation[] = []
  const touchedIds = new Set<string>()
  const blockIdsAtLevel: string[] = []

  matchedTree.forEach((node, idx) => {
    const b = node.block as Record<string, unknown>
    const blockId = b.id as string
    touchedIds.add(blockId)
    blockIdsAtLevel.push(blockId)

    const oldEntry = oldMap[blockId]
    const isNew = !oldEntry

    if (isNew) {
      // New block: emit ReplaceBlock with the HMBlock directly
      ops.push({type: 'ReplaceBlock', block: node.block})
    } else {
      // Existing block: only ReplaceBlock if content changed
      if (!isBlockContentEqual(oldEntry.block, node.block)) {
        ops.push({type: 'ReplaceBlock', block: node.block})
      }

      // Check if position changed
      const prevNode = idx > 0 ? matchedTree[idx - 1] : undefined
      const expectedLeft = prevNode ? ((prevNode.block as Record<string, unknown>).id as string) : ''
      if (oldEntry.parent !== parentId || oldEntry.left !== expectedLeft) {
        // Position changed — will be handled by the MoveBlocks below
      }
    }

    // Recurse into children
    const children = node.children || []
    if (children.length > 0) {
      const childOps = computeReplaceOps(oldMap, children, blockId)
      ops.push(...childOps)

      // Collect touched IDs from children
      collectIds(children, touchedIds)
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

function collectIds(nodes: HMBlockNode[], set: Set<string>) {
  for (const node of nodes) {
    set.add((node.block as Record<string, unknown>).id as string)
    collectIds(node.children || [], set)
  }
}

/**
 * Compare old API block content with new HMBlock content.
 * Returns true if they're semantically equal.
 */
function isBlockContentEqual(old: APIBlock, newBlock: HMBlock): boolean {
  const nb = newBlock as Record<string, unknown>
  if (old.type !== nb.type) return false
  if ((old.text || '') !== ((nb.text as string) || '')) return false

  // Compare link field (images, embeds, etc.)
  if ((old.link || '') !== ((nb.link as string) || '')) return false

  // Compare annotations
  const oldAnn = old.annotations || []
  const newAnn = (nb.annotations as unknown[]) || []
  if (oldAnn.length !== newAnn.length) return false
  if (oldAnn.length > 0 && JSON.stringify(oldAnn) !== JSON.stringify(newAnn)) {
    return false
  }

  // Compare relevant attributes
  const oldAttrs = old.attributes || {}
  const newAttrs = (nb.attributes as Record<string, unknown>) || {}
  if ((oldAttrs.childrenType || '') !== (newAttrs.childrenType || '')) {
    return false
  }
  if ((oldAttrs.language || '') !== (newAttrs.language || '')) return false

  return true
}
