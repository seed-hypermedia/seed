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
  /** Called when the set of fully-selected blocks changes. Receives the IDs of blocks whose entire content is covered by the current selection. */
  onBlocksFullSelected?: (blockIds: string[]) => void
  /** Called when the editor instance is created. Used by the desktop app to capture the editor ref for draft saving. */
  onEditorReady?: (editor: any) => void
  /** Cursor position saved in the draft file; used to restore cursor on reload. */
  draftCursorPosition?: number | null
}
