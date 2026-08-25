import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {IS_DESKTOP} from '@shm/shared/constants'
import {FolderTree, PanelLeft, X} from 'lucide-react'
import {createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {Button} from './button'
import {SpaceFileBrowser} from './space-file-browser'
import {Tooltip} from './tooltip'
import {useMedia} from './use-media'

/** Collapse state of the inline file browser, shared with the page chrome below it. */
export interface SpaceFileBrowserControls {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  /**
   * Claims the reveal button so the layout stops rendering its own floating
   * fallback. Returns a release callback.
   */
  claimRevealButton: () => () => void
}

const SpaceFileBrowserContext = createContext<SpaceFileBrowserControls | null>(null)

/** Returns the inline file browser controls, or null outside a space layout (Electron, embeds). */
export function useSpaceFileBrowserControls(): SpaceFileBrowserControls | null {
  return useContext(SpaceFileBrowserContext)
}

/** Props for the responsive space file browser layout. */
export interface SpaceFileBrowserLayoutProps {
  spaceId: UnpackedHypermediaId
  activeDocumentId: UnpackedHypermediaId | null
  spaceName: string
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  onNavigate: (id: UnpackedHypermediaId) => void
  onPrefetch?: (id: UnpackedHypermediaId) => void
  children: ReactNode
}

/** Places the space file browser inline on wide layouts and in a left drawer on mobile. */
export function SpaceFileBrowserLayout({
  spaceId,
  activeDocumentId,
  spaceName,
  mobileOpen,
  onMobileOpenChange,
  onNavigate,
  onPrefetch,
  children,
}: SpaceFileBrowserLayoutProps) {
  const media = useMedia()
  const isMobile = media.xs && !IS_DESKTOP
  const [isClient, setIsClient] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const desktopContainerRef = useRef<HTMLDivElement>(null)
  const browserPanelRef = useRef<ImperativePanelHandle>(null)
  const [minimumPercent, setMinimumPercent] = useState(20)
  const [revealClaims, setRevealClaims] = useState(0)
  const didSetInitialWidth = useRef(false)
  const browser = (
    <SpaceFileBrowser
      spaceId={spaceId}
      activeDocumentId={activeDocumentId}
      onNavigate={onNavigate}
      onPrefetch={onPrefetch}
    />
  )
  // Only the inline (wide) layout has a collapse affordance; the mobile drawer is
  // opened from the space header, so page chrome below gets no controls there.
  const controls = useMemo<SpaceFileBrowserControls>(
    () => ({
      collapsed,
      setCollapsed,
      claimRevealButton: () => {
        setRevealClaims((claims) => claims + 1)
        return () => setRevealClaims((claims) => claims - 1)
      },
    }),
    [collapsed],
  )

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
        <div className="dark:bg-background flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
          {children}
        </div>
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
                <aside className="dark:bg-background motion-safe:animate-in motion-safe:slide-in-from-left flex h-dvh w-[80dvw] max-w-[80dvw] shrink-0 flex-col bg-white shadow-2xl motion-safe:duration-200 motion-safe:ease-out">
                  <div className="border-border flex shrink-0 items-center border-b px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Files</p>
                      <p className="text-muted-foreground truncate text-xs">{spaceName}</p>
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
                  className="motion-safe:animate-in motion-safe:fade-in h-dvh flex-1 bg-black/45 motion-safe:duration-200"
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
    <SpaceFileBrowserContext.Provider value={controls}>
      <div ref={desktopContainerRef} className="flex min-h-0 flex-1">
        <PanelGroup direction="horizontal" className="min-h-0 flex-1">
          {!collapsed ? (
            <>
              <Panel
                id="space-file-browser"
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
                        <PanelLeft className="size-4" />
                      </Button>
                    </Tooltip>
                  </div>
                  <div className="min-h-0 flex-1">{browser}</div>
                </aside>
              </Panel>
              <PanelResizeHandle className="panel-resize-handle" />
            </>
          ) : null}
          <Panel id="space-main-content" order={2} minSize={60}>
            <div className="dark:bg-background relative flex h-full min-h-0 flex-col overflow-hidden bg-white">
              {collapsed && revealClaims === 0 ? (
                <div className="absolute top-2 left-2 z-50 md:top-4 md:left-4">
                  <Tooltip content="Show file explorer">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Open file browser"
                      onClick={() => setCollapsed(false)}
                    >
                      <FolderTree className="size-4" />
                    </Button>
                  </Tooltip>
                </div>
              ) : null}
              {children}
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </SpaceFileBrowserContext.Provider>
  )
}
