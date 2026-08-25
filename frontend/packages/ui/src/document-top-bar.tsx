import {FolderTree} from 'lucide-react'
import {ReactNode, useEffect} from 'react'
import {Button} from './button'
import {Breadcrumbs, type BreadcrumbEntry} from './document-header'
import {useSpaceFileBrowserControls} from './space-file-browser-layout'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * Persistent bar above the document content: where you are on the left, what you
 * can do on the right, both at the edges of the pane. It is a sibling of the
 * scroll container on desktop, and sticks to the top of the viewport on mobile
 * once the space header scrolls away.
 */
export function DocumentTopBar({
  breadcrumbs,
  status,
  actions,
  isMobile,
}: {
  breadcrumbs?: BreadcrumbEntry[]
  status?: ReactNode
  actions?: ReactNode
  isMobile?: boolean
}) {
  const fileBrowser = useSpaceFileBrowserControls()
  const canRevealFileBrowser = !!fileBrowser?.collapsed

  useEffect(() => {
    if (!canRevealFileBrowser || !fileBrowser) return
    return fileBrowser.claimRevealButton()
  }, [canRevealFileBrowser, fileBrowser])

  return (
    <div
      data-document-top-bar=""
      className={cn(
        'border-border dark:bg-background flex h-12 w-full shrink-0 items-center gap-2 bg-white px-4',
        // The border is the only separator; nothing is elevated over the content.
        'border-b',
        isMobile && 'sticky top-0 z-30',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {canRevealFileBrowser ? (
          <Tooltip content="Show file explorer">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open file browser"
              className="shrink-0"
              onClick={() => fileBrowser?.setCollapsed(false)}
            >
              <FolderTree className="size-4" />
            </Button>
          </Tooltip>
        ) : null}
        {breadcrumbs?.length ? <Breadcrumbs breadcrumbs={breadcrumbs} /> : null}
        {status ? (
          <div data-document-status="" className="flex shrink-0 items-center gap-1">
            {status}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}
