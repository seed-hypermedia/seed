import {useNavigate} from '@remix-run/react'
import {
  BlockRange,
  HMEntityContent,
  HMQueryResult,
  NavRoute,
  routeToHref,
  UnpackedHypermediaId,
  useUniversalAppContext,
} from '@shm/shared'
import {DocContentProvider} from '@shm/ui/document-content'
import {toast} from '@shm/ui/toast'
import {EmbedDocument, EmbedInline, QueryBlockWeb} from './web-embeds'

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
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (blockId?: string | null) => void
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}) {
  const navigate = useNavigate()
  const context = useUniversalAppContext()
  return (
    <DocContentProvider
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      entityComponents={{
        Document: EmbedDocument,
        // @ts-expect-error
        Inline: EmbedInline,
        Query: QueryBlockWeb,
        Comment: () => null,
      }}
      entityId={id}
      supportDocuments={supportDocuments}
      supportQueries={supportQueries}
      onBlockCopy={
        id
          ? (blockId, blockRange) => {
              // const blockHref = getHref(
              //   originHomeId,
              //   {
              //     ...id,
              //     hostname: siteHost || null,
              //     blockRange: blockRange || null,
              //     blockRef: blockId,
              //   },
              //   id.version || undefined,
              // )
              // window.navigator.clipboard.writeText(blockHref)
              // navigate(
              //   window.location.pathname +
              //     window.location.search +
              //     `#${blockId}${
              //       blockRange
              //         ? 'start' in blockRange && 'end' in blockRange
              //           ? `[${blockRange.start}:${blockRange.end}]`
              //           : ''
              //         : ''
              //     }`,
              //   {replace: true, preventScrollReset: true},
              // )
              const route = {
                key: 'document',
                id: {
                  uid: id.uid,
                  path: id.path,
                  version: id.version,
                  blockRef: blockId,
                  blockRange: blockRange,
                },
              } as NavRoute
              const href = routeToHref(route, {
                hmUrlHref: context.hmUrlHref,
                originHomeId: context.originHomeId,
              })
              if (!href) {
                toast.error('Failed to create block link')
                return
              }
              window.navigator.clipboard.writeText(href)
              navigate(href, {
                replace: true,
              })
              toast.success('Block link copied to clipboard')
            }
          : null
      }
      onBlockCommentClick={onBlockCommentClick}
      // @ts-expect-error
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
