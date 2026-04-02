import type {BlockRange, HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

/** Options for block range selection with optional clipboard copy. */
export type BlockRangeSelectOptions = BlockRange & {
  copyToClipboard?: boolean
}

export type DocumentContentProps = {
  blocks: HMBlockNode[]
  resourceId: UnpackedHypermediaId
  focusBlockId?: string
  blockCitations?: Record<string, {citations: number; comments: number}> | null
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (
    blockId?: string | null,
    blockRange?: BlockRange | undefined,
    startCommentingNow?: boolean,
  ) => void
  onBlockSelect?: (blockId: string, opts?: BlockRange & {copyToClipboard?: boolean}) => void
}
