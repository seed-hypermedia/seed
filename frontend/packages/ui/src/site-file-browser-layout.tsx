import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {IS_DESKTOP} from '@shm/shared/constants'
import {FolderTree, PanelLeftClose, X} from 'lucide-react'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {Button} from './button'
import {SiteFileBrowser} from './site-file-browser'
import {Tooltip} from './tooltip'
import {useMedia} from './use-media'

/** Props for the responsive site file browser layout. */
export interface SiteFileBrowserLayoutProps {
  siteId: UnpackedHypermediaId
  activeDocumentId: UnpackedHypermediaId | null
  siteName: string
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  onNavigate: (id: UnpackedHypermediaId) => void
  children: ReactNode
}

/** Places the site file browser inline on wide layouts and in a left drawer on mobile. */
export function SiteFileBrowserLayout({
  siteId,
  activeDocumentId,
  siteName,
  mobileOpen,
  onMobileOpenChange,
  onNavigate,
  children,
}: SiteFileBrowserLayoutProps) {
  const media = useMedia()
  const isMobile = media.xs && !IS_DESKTOP
  const [isClient, setIsClient] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const desktopContainerRef = useRef<HTMLDivElement>(null)
  const browserPanelRef = useRef<ImperativePanelHandle>(null)
  const [minimumPercent, setMinimumPercent] = useState(20)
  const didSetInitialWidth = useRef(false)
  const browser = <SiteFileBrowser siteId={siteId} activeDocumentId={activeDocumentId} onNavigate={onNavigate} />

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileOpenChange(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.documentElement.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileOpen, onMobileOpenChange])

  useEffect(() => {
    if (isMobile || !desktopContainerRef.current) return
    const updateConstraints = () => {
      const width = desktopContainerRef.current?.getBoundingClientRect().width ?? 0
      if (!width) return
      setMinimumPercent(Math.min(40, (240 / width) * 100))
      if (!didSetInitialWidth.current) {
        browserPanelRef.current?.resize(Math.min(40, (288 / width) * 100))
        didSetInitialWidth.current = true
      }
    }
    updateConstraints()
    const observer = new ResizeObserver(updateConstraints)
    observer.observe(desktopContainerRef.current)
    return () => observer.disconnect()
  }, [isMobile])

  if (!isClient) {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="border-border dark:bg-background hidden h-full w-72 shrink-0 flex-col border-r bg-white md:flex">
          <div className="border-border flex h-12 shrink-0 items-center border-b px-3">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">Documents</p>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <div className="border-border bg-muted/40 h-9 rounded-md border" />
            <div className="mt-3 space-y-2">
              <div className="bg-muted h-4 w-3/4 rounded" />
              <div className="bg-muted h-4 w-2/3 rounded" />
              <div className="bg-muted h-4 w-1/2 rounded" />
            </div>
          </div>
        </aside>
        <div className="dark:bg-background h-full min-h-0 flex-1 overflow-hidden bg-white">{children}</div>
      </div>
    )
  }

  if (isMobile) {
    return (
      <>
        <div className="min-h-0 flex-1">{children}</div>
        {mobileOpen
          ? createPortal(
              <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="File browser">
                <aside className="dark:bg-background flex h-dvh w-4/5 flex-col bg-white shadow-2xl">
                  <div className="border-border flex shrink-0 items-center border-b px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Files</p>
                      <p className="text-muted-foreground truncate text-xs">{siteName}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Close file browser"
                      onClick={() => onMobileOpenChange(false)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">{browser}</div>
                </aside>
                <button
                  type="button"
                  aria-label="Close file browser"
                  className="h-dvh w-1/5 bg-black/45"
                  onClick={() => onMobileOpenChange(false)}
                />
              </div>,
              document.body,
            )
          : null}
      </>
    )
  }

  return (
    <div ref={desktopContainerRef} className="flex min-h-0 flex-1">
      {collapsed ? (
        <div className="border-border dark:bg-background shrink-0 border-r bg-white p-2">
          <Tooltip content="Show file explorer">
            <Button variant="ghost" size="icon" aria-label="Open file browser" onClick={() => setCollapsed(false)}>
              <FolderTree className="size-4" />
            </Button>
          </Tooltip>
        </div>
      ) : null}
      <PanelGroup direction="horizontal" className="min-h-0 flex-1">
        {!collapsed ? (
          <>
            <Panel
              id="site-file-browser"
              ref={browserPanelRef}
              order={1}
              defaultSize={24}
              minSize={minimumPercent}
              maxSize={40}
            >
              <aside className="border-border dark:bg-background flex h-full flex-col border-r bg-white">
                <div className="border-border flex h-12 shrink-0 items-center border-b px-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">Documents</p>
                  <Tooltip content="Hide file explorer">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Collapse file browser"
                      onClick={() => setCollapsed(true)}
                    >
                      <PanelLeftClose className="size-4" />
                    </Button>
                  </Tooltip>
                </div>
                <div className="min-h-0 flex-1">{browser}</div>
              </aside>
            </Panel>
            <PanelResizeHandle className="panel-resize-handle" />
          </>
        ) : null}
        <Panel id="site-main-content" order={2} minSize={60}>
          <div className="dark:bg-background h-full min-h-0 overflow-hidden bg-white">{children}</div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
