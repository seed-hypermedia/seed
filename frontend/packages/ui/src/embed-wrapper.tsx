import {NavRoute, UnpackedHypermediaId} from '@shm/shared'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {HTMLAttributes, PropsWithChildren, useMemo} from 'react'
import {blockStyles} from './blocks-content'
import {useHighlighter} from './highlight-context'
import {cn} from './utils'

export function EmbedWrapper({
  id,
  parentBlockId,
  children,
  depth,
  viewType = 'Content',
  hideBorder = false,
  isRange = false,
  route,
  openOnClick = true,
  ...props
}: PropsWithChildren<
  {
    id?: UnpackedHypermediaId
    parentBlockId: string | null
    depth?: number
    viewType?: 'Content' | 'Card' | 'Comments'
    hideBorder?: boolean
    isRange?: boolean
    route?: NavRoute
    openOnClick?: boolean
  } & Omit<HTMLAttributes<HTMLDivElement>, 'id'>
>) {
  const navigate = useNavigate()
  const highlight = useHighlighter()
  const currentRoute = useNavRoute()

  // If current route has a panel, preserve it when navigating to documents
  const effectiveRoute = useMemo(() => {
    if (!route) return route
    // Only modify document routes that don't already have a panel
    if (route.key === 'document' && !route.panel) {
      // Preserve panel from current document/feed route
      if (currentRoute.key === 'document' && currentRoute.panel) {
        return {...route, panel: currentRoute.panel}
      }
      if (currentRoute.key === 'feed' && currentRoute.panel) {
        return {...route, panel: currentRoute.panel}
      }
    }
    return route
  }, [route, currentRoute])

  if (!id) return null
  return (
    <div
      contentEditable={false}
      className={cn(
        'block-embed flex flex-col',
        blockStyles,
        !hideBorder && 'border-l-primary border-l-3',
        'm-0 rounded-none',
        isRange && 'hm-embed-range-wrapper',
      )}
      data-content-type="embed"
      data-url={packHmId(id)}
      data-view={viewType}
      data-blockid={
        id &&
        id.blockRange &&
        'expanded' in id.blockRange &&
        id.blockRange.expanded
          ? id?.blockRef
          : undefined
      }
      data-resourceid={id?.blockRef ? undefined : id?.id}
      onClick={
        openOnClick && effectiveRoute
          ? (e) => {
              e.stopPropagation()
              const selection = window.getSelection()
              const hasSelection = selection && selection.toString().length > 0
              if (hasSelection) {
                return
              }
              e.preventDefault()
              navigate(effectiveRoute)
            }
          : undefined
      }
      {...highlight(id)}
      {...props}
    >
      {children}
    </div>
  )
}
