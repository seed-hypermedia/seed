import {useNavigate} from '@remix-run/react'
import {
  BlockRange,
  HMEntityContent,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {DocContentProvider} from '@shm/ui/document-content'
import {getHref} from './href'
import {
  EmbedComment,
  EmbedDocument,
  EmbedInline,
  QueryBlockWeb,
} from './web-embeds'

export function WebDocContentProvider({
  children,
  id,
  originHomeId,
  siteHost,
  supportDocuments,
  supportQueries,
  routeParams,
  comment,
  blockCitations,
  onBlockCitationClick,
  onBlockCommentClick,
  onHoverIn,
  onHoverOut,
}: {
  siteHost: string | undefined
  id?: UnpackedHypermediaId | undefined
  originHomeId: UnpackedHypermediaId | undefined
  children: React.ReactNode | JSX.Element
  supportDocuments?: HMEntityContent[]
  supportQueries?: HMQueryResult[]
  routeParams?: {
    uid?: string
    version?: string
    blockRef?: string
    blockRange?: BlockRange
  }
  comment?: boolean
  blockCitations?: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
  onBlockCitationClick?: (blockId?: string) => void
  onBlockCommentClick?: (blockId?: string) => void
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}) {
  console.log('~~ WebDocContentProvider blockCitations', blockCitations)
  const navigate = useNavigate()
  return (
    <DocContentProvider
      entityComponents={{
        Document: EmbedDocument,
        Comment: EmbedComment,
        Inline: EmbedInline,
        Query: QueryBlockWeb,
      }}
      entityId={id}
      supportDocuments={supportDocuments}
      supportQueries={supportQueries}
      onBlockCopy={
        id
          ? (blockId, blockRange) => {
              const blockHref = getHref(
                originHomeId,
                {
                  ...id,
                  hostname: siteHost || null,
                  blockRange: blockRange || null,
                  blockRef: blockId,
                },
                id.version || undefined,
              )
              window.navigator.clipboard.writeText(blockHref)
              navigate(
                window.location.pathname +
                  window.location.search +
                  `#${blockId}${
                    blockRange
                      ? 'start' in blockRange && 'end' in blockRange
                        ? `[${blockRange.start}:${blockRange.end}]`
                        : ''
                      : ''
                  }`,
                {replace: true, preventScrollReset: true},
              )
            }
          : null
      }
      onBlockCommentClick={onBlockCommentClick}
      onBlockCitationClick={onBlockCitationClick}
      routeParams={routeParams}
      textUnit={18}
      layoutUnit={24}
      debug={false}
      comment={comment}
      blockCitations={blockCitations}
    >
      {children}
    </DocContentProvider>
  )
}
