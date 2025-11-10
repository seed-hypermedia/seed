import {PlainMessage} from '@bufbuild/protobuf'
import {
  BlockRange,
  ExpandedBlockRange,
  HMBlock,
  HMCitation,
  HMEntityContent,
  HMQueryResult,
} from './hm-types'

import {Contact} from './client'
import {UnpackedHypermediaId} from './hm-types'

export type BlockRangeSelectOptions = (BlockRange | ExpandedBlockRange) & {
  copyToClipboard?: boolean
}

export type BlocksContentContextValue = {
  saveCidAsFile?: (cid: string, name: string) => Promise<void>
  citations?: HMCitation[]
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockSelect:
    | null
    | ((blockId: string, blockRange?: BlockRangeSelectOptions) => void)
  onBlockCommentClick?:
    | null
    | ((
        blockId: string,
        blockRange?: BlockRange | ExpandedBlockRange | undefined,
        startCommentingNow?: boolean,
      ) => void)
  layoutUnit: number
  textUnit: number
  debug: boolean
  ffSerif?: boolean
  comment?: boolean
  routeParams?: {
    uid?: string
    version?: string
    blockRef?: string
    blockRange?: BlockRange
  }
  contacts?: PlainMessage<Contact>[] | null
  importWebFile?: any
  handleFileAttachment?: (
    file: File,
  ) => Promise<{displaySrc: string; fileBinary: Uint8Array}>
  openUrl?: (url?: string, newWindow?: boolean) => void
  supportDocuments?: HMEntityContent[]
  supportQueries?: HMQueryResult[]
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
  collapsedBlocks: Set<string>
  setCollapsedBlocks: (id: string, val: boolean) => void
  blockCitations?: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
}

export type BlockContentProps<BlockType extends HMBlock = HMBlock> = {
  block: BlockType
  parentBlockId: string | null
  depth?: number
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
  style?: React.CSSProperties
}
