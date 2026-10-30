import {Minimize2} from 'lucide-react'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {Button} from './button'
import {Breadcrumbs, type BreadcrumbEntry} from './document-header'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * Persistent bar above the document content: where you are on the left, what you
 * can do on the right, both at the edges of the pane. It is a sibling of the
 * scroll container on desktop, and sticks to the top of the viewport on mobile
 * once the site header scrolls away.
 */
export function DocumentTopBar({
  breadcrumbs,
  status,
  actions,
  isMobile,
  collapseAction,
}: {
  breadcrumbs?: BreadcrumbEntry[]
  status?: ReactNode
  actions?: ReactNode
  isMobile?: boolean
  /** Show a fallback collapse action only while its inline button is offscreen. */
  collapseAction?: {
    inlineButton: HTMLButtonElement | null
    title: string
    onCollapse: () => void
  }
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [offscreenButton, setOffscreenButton] = useState<Element | null>(null)
  const inlineButton = collapseAction?.inlineButton
  const showCollapse = !!inlineButton && offscreenButton === inlineButton

  useEffect(() => {
    setOffscreenButton(null)
    if (!inlineButton || typeof IntersectionObserver === 'undefined') return
    // Desktop scroll containers clip the target naturally. On mobile, exclude the
    // sticky breadcrumb row as well, so a button covered by it counts as offscreen.
    const topInset = isMobile ? barRef.current?.getBoundingClientRect().height ?? 0 : 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setOffscreenButton(entry.isIntersecting ? null : entry.target)
      },
      {rootMargin: `-${topInset}px 0px 0px 0px`},
    )
    observer.observe(inlineButton)
    return () => observer.disconnect()
  }, [inlineButton, isMobile])

  return (
    <div
      ref={barRef}
      data-document-top-bar=""
      className={cn(
        'border-border dark:bg-background relative z-40 flex h-12 w-full shrink-0 items-center gap-2 bg-white px-4',
        // The border is the only separator; nothing is elevated over the content.
        'border-b',
        isMobile && 'sticky top-0',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {breadcrumbs?.length ? <Breadcrumbs breadcrumbs={breadcrumbs} /> : null}
        {status ? (
          <div data-document-status="" className="flex shrink-0 items-center gap-1">
            {status}
          </div>
        ) : null}
      </div>
      {actions || showCollapse ? (
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {showCollapse && collapseAction ? (
            <Tooltip content="Collapse">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Collapse ${collapseAction.title}`}
                onClick={collapseAction.onCollapse}
              >
                <Minimize2 className="size-4" />
                <span className="hidden sm:inline">Collapse</span>
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
