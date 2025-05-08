import {useNavigate} from '@remix-run/react'
import {BlockRange, HMCitationsPayload, UnpackedHypermediaId} from '@shm/shared'
import {DocContentProvider} from '@shm/ui/document-content'
import {getHref} from './href'

export function WebDocContentProvider({
  children,
  id,
  originHomeId,
  siteHost,
  routeParams,
  comment,
  citations,
  onBlockCitationClick,
  onBlockCommentClick,
  onHoverIn,
  onHoverOut,
}: {
  siteHost: string | undefined
  id?: UnpackedHypermediaId | undefined
  originHomeId: UnpackedHypermediaId | undefined
  children: React.ReactNode | JSX.Element
  routeParams?: {
    uid?: string
    version?: string
    blockRef?: string
    blockRange?: BlockRange
  }
  comment?: boolean
  citations?: HMCitationsPayload
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCommentClick?: (blockId?: string | null) => void
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}) {
  const navigate = useNavigate()
  return (
    <DocContentProvider
      entityId={id}
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
      onBlockCommentClick={onBlockCommentClick}
      onBlockCitationClick={onBlockCitationClick}
      routeParams={routeParams}
      textUnit={18}
      layoutUnit={24}
      debug={false}
      comment={comment}
      citations={citations}
      // onHoverIn={onHoverIn}
      // onHoverOut={onHoverOut}
    >
      {children}
    </DocContentProvider>
  )
}
