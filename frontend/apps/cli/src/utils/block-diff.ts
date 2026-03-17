/**
 * Re-export block diffing utilities from @seed-hypermedia/client.
 */
export {
  createBlocksMap,
  matchBlockIds,
  computeReplaceOps,
  hmBlockNodeToBlockNode,
} from '@seed-hypermedia/client/block-diff'
export type {APIBlockNode, APIBlock} from '@seed-hypermedia/client/block-diff'
