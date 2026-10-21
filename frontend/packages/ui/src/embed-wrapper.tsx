import './blocks-content.css'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getRoutePanel, type DocumentPanelRoute, type DocumentRoute, type NavRoute} from '@shm/shared'
import {useRouteLink} from '@shm/shared/routing'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {HTMLAttributes, MouseEvent, PropsWithChildren, ReactNode, useMemo, useRef} from 'react'
import {blockStyles} from './blocks-content-utils'
import {useHighlighter} from './highlight-context'
import {cn} from './utils'
import {ChevronDown, ChevronUp} from 'lucide-react'
import {Button} from './button'
import {Tooltip} from './tooltip'

function isInteractiveEmbedClickTarget(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement | null
  if (!target?.closest) return false

  const embedEl = target.closest('[data-content-type="embed"]')
  const interactiveEl = target.closest(
    'a[href], .link[href], button, input, textarea, select, [role="button"], [data-embed-interactive]',
  )

  return !!interactiveEl && interactiveEl !== embedEl
}

/** Builds a document route for an embed while retaining the currently active panel. */
export function getEmbedDocumentRoute(id: UnpackedHypermediaId, currentRoute: NavRoute): DocumentRoute {
  const panel = getRoutePanel(currentRoute) as DocumentPanelRoute | null
  return panel ? {key: 'document', id, panel} : {key: 'document', id}
}

/** Source navigation and quote frame shared by all embed presentations. */
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

  // Preserve any active panel when navigating an embed to a document.
  const effectiveRoute = useMemo(() => {
    if (!route) return route
    if (route.key === 'document' && !route.panel) {
      return getEmbedDocumentRoute(route.id, currentRoute)
    }
    return route
  }, [route, currentRoute])

  const linkProps = useRouteLink(openOnClick && effectiveRoute ? effectiveRoute : null)
  const {onClick: routeOnClick, tag: _routeTag, ...linkAttributes} = linkProps
  const sourceLink = useRef<HTMLAnchorElement>(null)
  const canNavigate = !!(openOnClick && effectiveRoute)

  const openSource = (event: MouseEvent<HTMLElement>) => {
    const middleClick = event.type === 'auxclick' && event.button === 1
    if (event.type === 'auxclick' && !middleClick) return
    if (isInteractiveEmbedClickTarget(event)) return

    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      event.preventDefault()
      return
    }
    // A middle-click uses the same new-tab route as Ctrl-click on the source link.
    if (middleClick) event.preventDefault()
    event.stopPropagation()
    const link = sourceLink.current
    if (!link) return
    const previousTarget = link.getAttribute('target')
    // Browsers do not apply modifier navigation to synthetic clicks.
    if (middleClick || event.ctrlKey || event.metaKey || event.shiftKey) link.target = '_blank'
    try {
      link.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: event.ctrlKey || middleClick,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        }),
      )
    } finally {
      if (previousTarget === null) link.removeAttribute('target')
      else link.setAttribute('target', previousTarget)
    }
  }

  if (!id) return null
  return (
    <div
      contentEditable={false}
      className={cn(
        'block-embed hm-prose flex flex-col',
        blockStyles,
        !hideBorder && 'border-l-primary border-l-3',
        'focus-within:outline-ring m-0 rounded-none focus-within:outline-2 focus-within:outline-offset-2',
        openOnClick && effectiveRoute && 'cursor-pointer text-inherit no-underline',
      )}
      data-is-range={isRange ? 'true' : undefined}
      data-content-type="embed"
      data-url={packHmId(id)}
      data-view={viewType}
      data-blockid={
        id && id.blockRange && 'expanded' in id.blockRange && id.blockRange.expanded ? id?.blockRef : undefined
      }
      data-resourceid={id?.blockRef ? undefined : id?.id}
      onClick={canNavigate ? openSource : undefined}
      onAuxClick={canNavigate ? openSource : undefined}
      {...highlight(id)}
      {...props}
    >
      {canNavigate ? (
        <a ref={sourceLink} {...linkAttributes} onClick={routeOnClick} className="sr-only">
          Open embedded content
        </a>
      ) : null}
      {children}
    </div>
  )
}

/** Displays a fragment with a caret that expands its source in place. */
export function FragmentEmbedControls({
  expanded,
  onExpandedChange,
  children,
  sourceLabel = 'block',
}: {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  children: ReactNode
  sourceLabel?: 'block' | 'comment'
}) {
  const toggleLabel = expanded ? `Hide full ${sourceLabel}` : `Show full ${sourceLabel}`
  const Caret = expanded ? ChevronUp : ChevronDown
  return (
    <div className="bg-muted/30 relative min-h-8 rounded-sm py-1">
      {children}
      <Tooltip content={toggleLabel} asChild>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          className={cn(
            'text-muted-foreground hover:text-foreground active:bg-accent absolute right-1 size-6',
            expanded ? 'top-1' : 'top-1/2 -translate-y-1/2',
          )}
          aria-label={toggleLabel}
          aria-expanded={expanded}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onExpandedChange(!expanded)
          }}
        >
          <Caret className="size-3" aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  )
}
