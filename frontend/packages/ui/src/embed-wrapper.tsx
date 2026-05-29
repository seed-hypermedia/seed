import './blocks-content.css'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {NavRoute} from '@shm/shared'
import {useRouteLink} from '@shm/shared/routing'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {HTMLAttributes, PropsWithChildren, useMemo} from 'react'
import {blockStyles} from './blocks-content-utils'
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
    viewType?: 'Content' | 'Card' | 'Comments' | 'Link'
    hideBorder?: boolean
    isRange?: boolean
    route?: NavRoute
    openOnClick?: boolean
  } & Omit<HTMLAttributes<HTMLElement>, 'id'>
>) {
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

  const linkProps = useRouteLink(openOnClick && effectiveRoute ? effectiveRoute : null)
  const {onClick: routeOnClick, tag: _routeTag, ...linkAttributes} = linkProps
  const Wrapper = openOnClick && effectiveRoute ? 'a' : 'div'

  if (!id) return null
  return (
    <Wrapper
      contentEditable={false}
      className={cn(
        'block-embed hm-prose flex flex-col',
        blockStyles,
        !hideBorder && 'border-l-primary border-l-3',
        'm-0 rounded-none',
        isRange && 'hm-embed-range-wrapper',
        openOnClick && effectiveRoute && 'cursor-pointer text-inherit no-underline',
      )}
      data-content-type="embed"
      data-url={packHmId(id)}
      data-view={viewType}
      data-blockid={
        id && id.blockRange && 'expanded' in id.blockRange && id.blockRange.expanded ? id?.blockRef : undefined
      }
      data-resourceid={id?.blockRef ? undefined : id?.id}
      {...(openOnClick && effectiveRoute ? linkAttributes : {})}
      onClick={
        openOnClick && effectiveRoute
          ? (e) => {
              const selection = window.getSelection()
              const hasSelection = selection && selection.toString().length > 0
              if (hasSelection) {
                e.preventDefault()
                return
              }
              routeOnClick?.(e)
            }
          : undefined
      }
      {...highlight(id)}
      {...props}
    >
      {children}
    </Wrapper>
  )
}
