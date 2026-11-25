import {IS_DESKTOP} from '@shm/shared/constants'
import {getRouteKey, useNavigate, useNavRouteOrNull} from '@shm/shared/utils/navigation'
import {useEffect, useRef, useState, type ReactNode} from 'react'
import {Group, Panel} from 'react-resizable-panels'
import {Dialog, DialogContent, DialogTitle} from './components/dialog'
import {focusExploreSearch} from './explore-search-focus'
import {AnimatedPanel, PanelSeparator, useSavedPanelLayout} from './resizable-panels'
import type {SiteFileBrowserProps} from './site-file-browser'
import {SiteSidebar, SiteSidebarDocuments} from './site-sidebar'
import {SiteSidebarPortal, SiteSidebarProvider, usePersistedSidebarOpen, useSiteSidebar} from './site-sidebar-context'
import {useMedia} from './use-media'

/** Page-owned browser data; desktop renders it in the existing application sidebar. */
export interface SiteFileBrowserLayoutProps
  extends Omit<SiteFileBrowserProps, 'searchVisible' | 'onSearchVisibleChange'> {
  siteName: string
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  showDocumentBrowser?: boolean
  children: ReactNode
}

/** Consolidates the file browser into the application sidebar on both platforms. */
export function SiteFileBrowserLayout(props: SiteFileBrowserLayoutProps) {
  const sidebar = useSiteSidebar()
  useCollapseOnArrival(props.siteId.uid, props.showDocumentBrowser, IS_DESKTOP ? sidebar : null)
  if (IS_DESKTOP && sidebar) {
    return (
      <>
        <SiteSidebarPortal>
          <SiteSidebarDocuments {...props} />
        </SiteSidebarPortal>
        {props.children}
      </>
    )
  }
  return <WebSiteSidebarLayout {...props} />
}

// The space the sidebar last arrived at, and whether it collapsed there. Kept outside React because a page's
// layout remounts as the reader moves between pages, while arriving at a space happens once per visit.
const arrival: {spaceUid: string | null; collapsed: boolean} = {spaceUid: null, collapsed: false}

/**
 * Collapses the sidebar on arriving at a space whose document browser is off, and reopens it on leaving for a space
 * where it's on, unless the reader opened it themselves in between.
 */
function useCollapseOnArrival(
  spaceUid: string,
  showDocumentBrowser: boolean | undefined,
  sidebar: {open: boolean; setOpen: (open: boolean) => void} | null,
) {
  const open = sidebar?.open
  // Opening the sidebar is the reader's choice, so it isn't undone on leaving the space.
  useEffect(() => {
    if (open) arrival.collapsed = false
  }, [open])
  useEffect(() => {
    if (!sidebar || showDocumentBrowser === undefined || arrival.spaceUid === spaceUid) return
    arrival.spaceUid = spaceUid
    if (!showDocumentBrowser) {
      if (sidebar.open) {
        sidebar.setOpen(false)
        arrival.collapsed = true
      }
    } else if (arrival.collapsed) {
      arrival.collapsed = false
      if (!sidebar.open) sidebar.setOpen(true)
    }
  }, [spaceUid, showDocumentBrowser, sidebar])
}

function WebSiteSidebarLayout({
  children,
  mobileOpen,
  onMobileOpenChange,
  siteName,
  showDocumentBrowser,
  ...props
}: SiteFileBrowserLayoutProps) {
  const media = useMedia()
  const isMobile = media.xs && !IS_DESKTOP
  const [open, setOpen] = usePersistedSidebarOpen(IS_DESKTOP)
  const [hydrated, setHydrated] = useState(false)
  useCollapseOnArrival(props.siteId.uid, showDocumentBrowser, hydrated && !isMobile ? {open, setOpen} : null)
  const layout = useSavedPanelLayout('site-sidebar', ['site-sidebar', 'site-main-content'])
  const navigate = useNavigate()
  const route = useNavRouteOrNull()
  const routeKey = route ? getRouteKey(route) : props.activeDocumentId?.id
  const triggerRef = useRef<HTMLElement | null>(null)
  useEffect(() => setHydrated(true), [])
  useEffect(() => {
    // Entering mobile or navigating (including browser history) closes only the drawer.
    if (isMobile) onMobileOpenChange(false)
  }, [isMobile, routeKey, props.siteId.uid, onMobileOpenChange])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (IS_DESKTOP) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'k') return
      event.preventDefault()
      focusExploreSearch()
      onMobileOpenChange(false)
      navigate({key: 'explore', context: {type: 'site', id: {...props.siteId, latest: true, version: null}}})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, props.siteId.uid, onMobileOpenChange])

  const closeDrawer = () => onMobileOpenChange(false)
  const sidebar = (
    <SiteSidebar
      siteId={props.siteId}
      siteSelectorModal={isMobile}
      onNavigate={props.onNavigate}
      onAfterNavigate={closeDrawer}
    >
      <SiteSidebarDocuments
        {...props}
        onNavigate={(id) => {
          closeDrawer()
          props.onNavigate(id)
        }}
        onCreate={closeDrawer}
      />
    </SiteSidebar>
  )
  const updateOpen = (value: boolean) => {
    if (isMobile) {
      if (value) triggerRef.current = document.activeElement as HTMLElement | null
      onMobileOpenChange(value)
    } else setOpen(value)
  }
  return (
    <SiteSidebarProvider open={isMobile ? mobileOpen : open} setOpen={updateOpen}>
      {!hydrated || isMobile ? (
        <>
          {children}
          {hydrated && (
            <Dialog open={mobileOpen} onOpenChange={onMobileOpenChange}>
              <DialogContent
                aria-describedby={undefined}
                className="site-sidebar-drawer inset-y-0 left-0 h-dvh w-4/5 max-w-sm translate-x-0 translate-y-0 rounded-none"
                contentClassName="gap-0 p-0"
                showCloseButton={false}
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  triggerRef.current?.focus()
                }}
              >
                <DialogTitle className="sr-only">{siteName} sidebar</DialogTitle>
                {sidebar}
              </DialogContent>
            </Dialog>
          )}
        </>
      ) : (
        <Group
          orientation="horizontal"
          className="max-h-full min-h-0 flex-1"
          // Override Group's inline 100% height; the web shell has no fixed parent height.
          style={{height: '100dvh'}}
          onLayoutChanged={(next, meta) => {
            layout.onLayoutChanged(next, meta)
            if (meta.isUserInteraction) setOpen(next['site-sidebar'] !== 0)
          }}
        >
          <AnimatedPanel
            open={open}
            keepMounted
            id="site-sidebar"
            defaultSize={layout.expanded?.['site-sidebar'] ? `${layout.expanded['site-sidebar']}%` : 320}
            minSize={240}
            maxSize="40%"
          >
            {sidebar}
          </AnimatedPanel>
          <PanelSeparator open={open} />
          <Panel id="site-main-content" minSize="60%">
            {children}
          </Panel>
        </Group>
      )}
    </SiteSidebarProvider>
  )
}
