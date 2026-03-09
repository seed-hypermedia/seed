/**
 * HMBlockNode JSON parsing and conversion to document operations.
 */

import type {HMBlockNode} from '@shm/shared/hm-types'
import {HMBlockNodeSchema} from '@shm/shared/hm-types'
import {z} from 'zod'
import type {DocumentOperation} from '@seed-hypermedia/client'

/**
 * Parse and validate a JSON string as HMBlockNode[].
 */
export function parseBlocksJson(json: string): HMBlockNode[] {
  const parsed = JSON.parse(json)
  return z.array(HMBlockNodeSchema).parse(parsed)
}

/**
 * Convert HMBlockNode[] into document operations (ReplaceBlock + MoveBlocks).
 *
 * Same traversal pattern as flattenToOperations in markdown.ts but works
 * directly with HMBlockNode from @shm/shared.
 */
export function hmBlockNodesToOperations(
  nodes: HMBlockNode[],
  parentId: string = '',
): DocumentOperation[] {
  const ops: DocumentOperation[] = []
  const blockIds: string[] = []

  for (const node of nodes) {
    ops.push({type: 'ReplaceBlock', block: node.block})
    blockIds.push(node.block.id)

    if (node.children && node.children.length > 0) {
      ops.push(...hmBlockNodesToOperations(node.children, node.block.id))
    }
  }

  if (blockIds.length > 0) {
    ops.push({type: 'MoveBlocks', blocks: blockIds, parent: parentId})
  }

  return ops
}
