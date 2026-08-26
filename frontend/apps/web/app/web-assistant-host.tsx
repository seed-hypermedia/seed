import {useAssistantPanel} from '@/assistant-panel-state'
import {clientLazy} from '@/client-lazy'
import {MobilePanelSheet} from '@shm/ui/mobile-panel-sheet'
import {Spinner} from '@shm/ui/spinner'
import {useMedia} from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
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
 * Mounted once per page inside `WebSiteProvider`: the panel needs the site's navigation and
 * universal-app contexts (dialogs, in-app links, the current route for window context), and those
 * are per page on web. Open/closed and the selected session live above the outlet in
 * {@link useAssistantPanel}, so a route change remounts this host into the same state.
 *
 * Layout: a flex row whose first column is always the page — rendered whether or not the panel is
 * open, so toggling never remounts the page — and whose second column, when open, is a draggable
 * divider plus a sticky full-height aside. Pages that scroll the window keep doing so; the aside
 * sticks to the viewport beside them. Narrow screens get the shared bottom sheet instead of a
 * side-by-side split.
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
  const showSheet = panel.isOpen && isMobile

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
            <Suspense fallback={<PanelLoading />}>
              <WebAssistantPanelContent showClose />
            </Suspense>
          </aside>
        </>
      ) : null}
      {showSheet ? (
        <MobilePanelSheet isOpen title="Agents" onClose={panel.close}>
          {/* The sheet has its own close button, so the panel does not render a second one. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<PanelLoading />}>
              <WebAssistantPanelContent />
            </Suspense>
          </div>
        </MobilePanelSheet>
      ) : null}
    </div>
  )
}

function PanelLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <Spinner />
    </div>
  )
}
