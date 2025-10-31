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
import {useState} from 'react'

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
  layoutUnit,
  textUnit,
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
  layoutUnit?: number
  textUnit?: number
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (blockId?: string | null) => void
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}) {
  const navigate = useNavigate()
  const context = useUniversalAppContext()
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
    <DocContentProvider
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      collapsedBlocks={collapsedBlocks}
      setCollapsedBlocks={setCollapsedBlocks}
      supportDocuments={supportDocuments}
      supportQueries={supportQueries}
      onBlockCopy={
        id
          ? (blockId, blockRange) => {
              const shouldCopy = blockRange?.copyToClipboard !== false
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
                  blockRange:
                    blockRange && 'start' in blockRange && 'end' in blockRange
                      ? {start: blockRange.start, end: blockRange.end}
                      : null,
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
              if (shouldCopy) {
                window.navigator.clipboard.writeText(`${siteHost}${href}`)
                toast.success('Block link copied to clipboard')
              }
              navigate(href, {
                replace: true,
              })
            }
          : null
      }
      onBlockCommentClick={onBlockCommentClick}
      onBlockCitationClick={onBlockCitationClick}
      routeParams={routeParams}
      textUnit={textUnit || 18}
      layoutUnit={layoutUnit || 24}
      debug={false}
      comment={comment}
      blockCitations={blockCitations}
    >
      {children}
    </DocContentProvider>
  )
}
