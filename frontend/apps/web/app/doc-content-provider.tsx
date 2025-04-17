import {useNavigate} from '@remix-run/react'
import {
  BlockRange,
  HMCitationsPayload,
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
  citations,
  onCitationClick,
}: {
  siteHost: string | undefined
  id?: UnpackedHypermediaId | undefined
  originHomeId: UnpackedHypermediaId
  children: React.ReactNode | JSX.Element
  supportDocuments?: HMEntityContent[]
  supportQueries?: HMQueryResult[]
  routeParams?: {
    documentId?: string
    version?: string
    blockRef?: string
    blockRange?: BlockRange
  }
  comment?: boolean
  citations?: HMCitationsPayload
  onCitationClick?: (blockId?: string | null) => void
}) {
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
      onCopyBlock={
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
      onCitationClick={onCitationClick}
      routeParams={routeParams}
      textUnit={18}
      layoutUnit={24}
      debug={false}
      comment={comment}
      citations={citations}
    >
      {children}
    </DocContentProvider>
  )
}
