import {
  BlockRange,
  ExpandedBlockRange,
  HMBlock,
  HMBlockQuery,
  HMCitation,
  HMEntityContent,
  HMQueryResult,
} from './hm-types'

import {UnpackedHypermediaId} from './hm-types'

export type DocContentContextValue = {
  entityId: UnpackedHypermediaId | undefined
  entityComponents: EntityComponentsRecord
  saveCidAsFile?: (cid: string, name: string) => Promise<void>
  citations?: HMCitation[]
  onBlockCitationClick?: (blockId?: string | null) => void
  onCopyBlock:
    | null
    | ((blockId: string, blockRange?: BlockRange | ExpandedBlockRange) => void)
  onReplyBlock?: null | ((blockId: string) => void)
  onBlockCommentClick?:
    | null
    | ((blockId: string, blockRange?: BlockRange | ExpandedBlockRange) => void)
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
}

export type EntityComponentsRecord = {
  Document: React.FC<EntityComponentProps>
  Comment: React.FC<EntityComponentProps>
  Inline: React.FC<EntityComponentProps>
  Query: React.FC<{
    id: UnpackedHypermediaId
    block: HMBlockQuery
  }>
}
export type EntityComponentProps = BlockContentProps & UnpackedHypermediaId
export type BlockContentProps = {
  block: HMBlock
  parentBlockId: string | null
  depth: number
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}
