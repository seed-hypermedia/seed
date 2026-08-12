import {FolderTree} from 'lucide-react'
import {ReactNode, useEffect} from 'react'
import {Button} from './button'
import {Breadcrumbs, type BreadcrumbEntry} from './document-header'
import {useSiteFileBrowserControls} from './site-file-browser-layout'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Layout metrics used to align the bar's contents with the document content column. */
export interface DocumentTopBarLayoutProps {
  wrapperProps: {className?: string; style?: React.CSSProperties}
  sidebarProps: {className?: string; style?: React.CSSProperties}
  mainContentProps: {className?: string; style?: React.CSSProperties}
  showSidebars: boolean
}

/**
 * Persistent bar above the document content: where you are on the left, what you
 * can do on the right. It is a sibling of the scroll container on desktop, and
 * sticks to the top of the viewport on mobile once the site header scrolls away.
 */
export function DocumentTopBar({
  breadcrumbs,
  actions,
  layoutProps,
  isMobile,
}: {
  breadcrumbs?: BreadcrumbEntry[]
  actions?: ReactNode
  /** Omit on mobile, where the content column already spans the viewport. */
  layoutProps?: DocumentTopBarLayoutProps
  isMobile?: boolean
}) {
  const fileBrowser = useSiteFileBrowserControls()
  const canRevealFileBrowser = !!fileBrowser?.collapsed

  useEffect(() => {
    if (!canRevealFileBrowser || !fileBrowser) return
    return fileBrowser.claimRevealButton()
  }, [canRevealFileBrowser, fileBrowser])

  const row = (
    <>
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
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </>
  )

  return (
    <div
      data-document-top-bar=""
      className={cn(
        'border-border dark:bg-background flex h-12 w-full shrink-0 items-center bg-white',
        // The border is the only separator; nothing is elevated over the content.
        'border-b',
        isMobile && 'sticky top-0 z-30',
      )}
    >
      {layoutProps ? (
        <AlignedToContentColumn layoutProps={layoutProps}>{row}</AlignedToContentColumn>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">{row}</div>
      )}
    </div>
  )
}

/**
 * Mirrors the document content column so breadcrumbs line up with the title
 * below them, keeping the bar itself full width.
 */
function AlignedToContentColumn({
  layoutProps,
  children,
}: {
  layoutProps: DocumentTopBarLayoutProps
  children: ReactNode
}) {
  const {wrapperProps, sidebarProps, mainContentProps, showSidebars} = layoutProps

  if (!showSidebars) {
    return (
      <div style={wrapperProps.style} className="mx-auto flex w-full items-center justify-center">
        <div {...mainContentProps} className={cn(mainContentProps.className, 'flex min-w-0 items-center gap-2 px-4')}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div {...wrapperProps} className={cn(wrapperProps.className, 'flex flex-1 items-center')}>
      <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto !p-0')} />
      <div {...mainContentProps} className={cn(mainContentProps.className, 'flex min-w-0 items-center gap-2 px-4')}>
        {children}
      </div>
      <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto !p-0')} />
    </div>
  )
}
