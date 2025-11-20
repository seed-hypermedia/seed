import {
  BlockRange,
  HMEntityContent,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {BlockRangeSelectOptions} from '@shm/shared/blocks-content-types'
import {BlocksContentProvider} from '@shm/ui/blocks-content'
import {useState} from 'react'

export function WebBlocksContentProvider({
  children,
  onBlockSelect,
  supportDocuments,
  supportQueries,
  selection,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onHoverIn,
  onHoverOut,
  layoutUnit,
  textUnit,
  commentStyle,
}: {
  onBlockSelect?:
    | ((blockId: string, blockRange?: BlockRangeSelectOptions) => void)
    | null
    | undefined
  children: React.ReactNode | JSX.Element
  supportDocuments?: HMEntityContent[]
  supportQueries?: HMQueryResult[]
  selection?: {
    uid?: string
    version?: string
    blockRef?: string
    blockRange?: BlockRange
  }
  commentStyle?: boolean
  blockCitations?: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
  layoutUnit?: number
  textUnit?: number
  onBlockCitationClick?: ((blockId?: string | null) => void) | undefined | null
  onBlockCommentClick?: ((blockId?: string | null) => void) | undefined | null
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}) {
  const [collapsedBlocks, setCollapsedBlocksState] = useState<Set<string>>(
    new Set(),
  )
  const setCollapsedBlocks = (id: string, val: boolean) => {
    setCollapsedBlocksState((prev) => {
      const next = new Set(prev)
      if (val) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }
  return (
    <BlocksContentProvider
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      collapsedBlocks={collapsedBlocks}
      setCollapsedBlocks={setCollapsedBlocks}
      supportDocuments={supportDocuments}
      supportQueries={supportQueries}
      commentStyle={commentStyle}
      onBlockSelect={onBlockSelect}
      onBlockCommentClick={onBlockCommentClick}
      onBlockCitationClick={onBlockCitationClick}
      selection={selection}
      textUnit={textUnit || 18}
      layoutUnit={layoutUnit || 24}
      debug={false}
      blockCitations={blockCitations}
    >
      {children}
    </BlocksContentProvider>
  )
}
