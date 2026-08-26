import {useAssistantPanel} from '@/assistant-panel-state'
import {clientLazy} from '@/client-lazy'
import {useSiteContextSnapshot} from '@/site-context-bridge'
import {UniversalAppContext} from '@shm/shared'
import {NavContextProvider} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Spinner} from '@shm/ui/spinner'
import {useMedia} from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {ArrowLeft} from 'lucide-react'
import React, {Suspense, useCallback, useEffect, useRef, useState} from 'react'

// The panel body pulls in the agents models and the rich editor. Like the /hm/agents pages and the
// commenting editor, it is a separate client-only chunk that only loads once the panel opens, so
// nothing agents-related enters the initial bundle.
const WebAssistantPanelContent = clientLazy<{showClose?: boolean}>(async () => ({
  default: (await import('./web-assistant-panel-content')).default,
}))

const WIDTH_STORAGE_KEY = 'seed.assistant.width'
const DEFAULT_WIDTH_PX = 380
const MIN_WIDTH_PX = 280
/** The page keeps at least this share of the viewport, mirroring desktop's maxSize={40}. */
const MAX_WIDTH_FRACTION = 0.4

function clampWidth(width: number): number {
  const max = typeof window === 'undefined' ? Infinity : Math.max(MIN_WIDTH_PX, window.innerWidth * MAX_WIDTH_FRACTION)
  return Math.min(Math.max(width, MIN_WIDTH_PX), max)
}

/** Panel width in pixels, persisted across visits. Read after mount so SSR needs no width. */
function usePanelWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(DEFAULT_WIDTH_PX)
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
      if (Number.isFinite(stored) && stored > 0) setWidth(clampWidth(stored))
    } catch {
      // No storage: the default width is fine.
    }
  }, [])
  const update = useCallback((next: number) => {
    const clamped = clampWidth(next)
    setWidth(clamped)
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(clamped)))
    } catch {
      // ignore
    }
  }, [])
  return [width, update]
}

/**
 * Hosts the agents assistant panel beside the page, the way desktop's main window does.
 *
 * Mounted once, above the Remix outlet, so route changes never remount it: the panel keeps its
 * transcript, composer draft, scroll position, and WebSocket subscriptions while the page behind it
 * changes. The page-scoped contexts it needs — in-app navigation for dialogs and links, and the
 * current route for the window context it attaches to every send — are re-provided from the
 * site-context bridge, which the page on screen keeps up to date.
 *
 * Layout: a flex row whose first column is always the page — rendered whether or not the panel is
 * open, so toggling never remounts the page either — and whose second column, when open, is a
 * draggable divider plus a sticky full-height aside. Pages that scroll the window keep doing so;
 * the aside sticks to the viewport beside them. Narrow screens have no room for a split: the panel
 * takes the whole viewport and a "Back to page" bar returns to the page without closing the panel's
 * state, so reopening it from the account menu lands back in the same chat.
 */
export function WebAssistantHost({children}: {children: React.ReactNode}) {
  const panel = useAssistantPanel()
  const media = useMedia()
  const isMobile = media.xs
  const [width, setWidth] = usePanelWidth()
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{x: number; width: number} | null>(null)

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragStart.current = {x: event.clientX, width}
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setDragging(true)
    },
    [width],
  )
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return
      // The divider sits on the aside's left edge: dragging left widens the panel.
      setWidth(dragStart.current.width + (dragStart.current.x - event.clientX))
    },
    [setWidth],
  )
  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }, [])

  const showSidePanel = panel.isOpen && !isMobile
  const showFullScreen = panel.isOpen && isMobile

  return (
    <div className={cn('flex w-full flex-row items-stretch', dragging && 'cursor-col-resize select-none')}>
      <div className="min-w-0 flex-1">{children}</div>
      {showSidePanel ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize agents panel"
            className={cn('panel-resize-handle visible sticky top-0 h-dvh shrink-0 self-start', dragging && 'active')}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <aside
            aria-label="Agents"
            data-testid="web-assistant-panel"
            className="bg-background border-border sticky top-0 flex h-dvh shrink-0 flex-col self-start overflow-hidden border-l"
            style={{width}}
          >
            <PanelBody showClose />
          </aside>
        </>
      ) : null}
      {showFullScreen ? <FullScreenPanel onBack={panel.close} /> : null}
    </div>
  )
}

/** Narrow screens: the panel over the whole viewport, with a bar that returns to the page. */
function FullScreenPanel({onBack}: {onBack: () => void}) {
  // The page underneath must not scroll while the panel covers it, and Escape returns to the page
  // so nobody is stuck — the same courtesies the shared bottom sheet extends.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onBack])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agents"
      data-testid="web-assistant-panel-fullscreen"
      className="bg-background fixed inset-0 z-50 flex h-dvh w-full flex-col"
    >
      <div className="border-border flex shrink-0 items-center border-b px-1 py-1 pt-[env(safe-area-inset-top)]">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2" aria-label="Back to page">
          <ArrowLeft className="size-4" />
          Back to page
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
        <PanelBody />
      </div>
    </div>
  )
}

/**
 * The lazy panel under the current page's contexts. Before any page has published (first paint,
 * or a page outside the site shell) the panel has nothing to navigate with, so it waits.
 */
function PanelBody({showClose}: {showClose?: boolean}) {
  const site = useSiteContextSnapshot()
  if (!site) return <PanelLoading />
  return (
    <UniversalAppContext.Provider value={site.universal}>
      <NavContextProvider value={site.navigation}>
        <Suspense fallback={<PanelLoading />}>
          <WebAssistantPanelContent showClose={showClose} />
        </Suspense>
      </NavContextProvider>
    </UniversalAppContext.Provider>
  )
}

function PanelLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <Spinner />
    </div>
  )
}
