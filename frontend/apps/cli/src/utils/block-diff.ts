/**
 * Re-export block diffing utilities from @seed-hypermedia/client.
 */
export {
  createBlocksMap,
  matchBlockIds,
  computeReplaceOps,
  hmBlockNodeToBlockNode,
  rebindTableIdentities,
} from '@seed-hypermedia/client/block-diff'
export type {APIBlockNode, APIBlock} from '@seed-hypermedia/client/block-diff'
