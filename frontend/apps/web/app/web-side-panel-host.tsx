import {transitionPanel} from '@shm/ui/resizable-panels'
import {useAssistantPanel} from '@/assistant-panel-state'
import {useLocalKeyPair} from '@/auth'
import {clientLazy, ClientOnly} from '@/client-lazy'
import {useSiteContextSnapshot} from '@/site-context-bridge'
import {UniversalAppContext} from '@shm/shared'
import {getRoutePanel} from '@shm/shared/routes'
import {useStreamSelector} from '@shm/shared/use-stream'
import {NavContextProvider, NO_NAV_STATE} from '@shm/shared/utils/navigation'
import {ActivityPanelOutlet, ActivityPanelProvider} from '@shm/ui/activity-panel-layout'
import type {WebAssistantAgents} from './web-assistant-activity'
import {AssistantPanelToggleContext, type AssistantPanelToggle} from '@shm/ui/assistant-panel-toggle'
import {Button} from '@shm/ui/button'
import {SidePanelSlotContent, useSidePanelSlot} from '@shm/ui/side-panel-slot'
import {Spinner} from '@shm/ui/spinner'
import {useMedia} from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {ArrowLeft} from 'lucide-react'
import React, {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react'

// The panel body pulls in the agents models and the rich editor. Like the /hm/agents pages and the
// commenting editor, it is a separate client-only chunk that only loads once the panel opens, so
// nothing agents-related enters the initial bundle.
const WebAssistantPanelContent = clientLazy<{showClose?: boolean; visible?: boolean}>(async () => ({
  default: (await import('./web-assistant-panel-content')).default,
}))

// The unread indicator needs the agents models (lists, sockets, read marks) — the same chunk the
// panel body lives in. Loaded for a signed-in reader whether or not the panel is open, so the
// header dot works with the panel closed and the header learns whether this reader has an agent
// here at all; nothing of it enters the initial bundle.
const WebAssistantActivity = lazy(() => import('./web-assistant-activity'))

const WIDTH_STORAGE_KEY = 'seed.side-panel.width'
const DEFAULT_WIDTH_PX = 320
const MIN_WIDTH_PX = 240
/** The page keeps at least this share of the viewport, mirroring desktop's maxSize={45}. */
const MAX_WIDTH_FRACTION = 0.45

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
 * Hosts the shared side panel beside the page, the way desktop's main window does: one slot that
 * Activity and Agents take turns holding — whichever opens last closes the other, so the two are
 * never open side by side.
 *
 * Mounted once, above the Remix outlet, so route changes never remount it: the panel keeps its
 * transcript, composer draft, scroll position, and WebSocket subscriptions while the page behind it
 * changes. The page-scoped contexts it needs — in-app navigation for dialogs and links, and the
 * current route both for the window context the assistant attaches to every send and for Activity,
 * which lives in the route — are re-provided from the site-context bridge, which the page on screen
 * keeps up to date.
 *
 * Layout: a flex row whose first column is always the page — rendered whether or not the panel is
 * open, so toggling never remounts the page either — and whose second column, when open, is a
 * draggable divider plus a sticky full-height aside. Pages that scroll the window keep doing so;
 * the aside sticks to the viewport beside them. Narrow screens have no room for a split: Activity
 * stays in the page's own sheet and Agents takes the whole viewport, with a "Back to page" bar that
 * returns to the page. Because that covers the page, it only happens when the reader opened the
 * panel themselves during this page load — a state restored by a reload keeps the panel out of the
 * way until they ask for it from the header.
 */
export function WebSidePanelHost({children}: {children: React.ReactNode}) {
  const panel = useAssistantPanel()
  // Agents are only usable signed in, so their panel only exists for a signed-in reader — a stored
  // "open" preference from a previous signed-in visit must not surface it to a signed-out visitor.
  // The preference itself is kept, so signing back in restores the panel as it was. Activity, a
  // route concern, is open to everyone.
  const keyPair = useLocalKeyPair()
  const media = useMedia()
  const isMobile = !!media.xs
  const snapshot = useSiteContextSnapshot()
  const route = useStreamSelector(snapshot?.navigation.state ?? NO_NAV_STATE, (state) => {
    return state.routes[state.routeIndex] ?? null
  })
  const activityOpen = route ? getRoutePanel(route)?.key === 'feed' : false
  const [width, setWidth] = usePanelWidth()
  const [dragging, setDragging] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const cancelMotion = useRef<(() => void) | undefined>(undefined)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const wasOpenedByReader = useRef(false)
  const previousMobile = useRef(isMobile)
  const dragStart = useRef<{x: number; width: number} | null>(null)
  // Activity "opened by the reader" means the route gained or lost its feed panel after the first
  // route the host saw — an Activity panel already in the URL at arrival is a restore, not an
  // action, and the slot must not animate open for it.
  const activityTouched = useRef(false)
  const previousActivityOpen = useRef<boolean | null>(null)

  // Activity holds the slot through the route: exclusivity closes replace the route (a panel switch
  // is not history), reader closes push one (Back returns to the panel).
  const closeActivity = useCallback(
    (replace: boolean) => {
      if (route && 'panel' in route) snapshot?.universal.openRoute?.({...route, panel: null}, replace)
    },
    [route, snapshot],
  )

  const active = useSidePanelSlot([
    ['activity', {open: activityOpen, close: () => closeActivity(true)}],
    ['assistant', {open: !!keyPair && panel.isOpen, close: panel.close, restored: !panel.openedByReader}],
  ])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      cancelMotion.current?.()
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

  const showSidePanel = active !== null && !isMobile
  const showFullScreen = active === 'assistant' && isMobile && panel.openedByReader
  useEffect(() => {
    const group = groupRef.current
    const aside = asideRef.current
    if (!group || !aside) return
    aside.inert = !showSidePanel
    if (!showSidePanel && aside.contains(document.activeElement)) {
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      else {
        group.tabIndex = -1
        group.focus({preventScroll: true})
      }
    }
    if (route) {
      if (previousActivityOpen.current === null) previousActivityOpen.current = activityOpen
      else if (previousActivityOpen.current !== activityOpen) {
        previousActivityOpen.current = activityOpen
        activityTouched.current = true
      }
    }
    const explicit = panel.openedByReader || wasOpenedByReader.current || activityTouched.current
    const resized = previousMobile.current !== isMobile
    wasOpenedByReader.current = panel.openedByReader
    previousMobile.current = isMobile
    if (showSidePanel === shown) return
    if (showSidePanel) {
      returnFocus.current = document.activeElement as HTMLElement
      setHasOpened(true)
    }
    if (isMobile || !explicit || resized) {
      cancelMotion.current?.()
      setShown(showSidePanel)
    } else {
      cancelMotion.current = transitionPanel(
        group,
        () => setShown(showSidePanel),
        () => {},
        'width',
      )
    }
  }, [showSidePanel, shown, isMobile, panel.openedByReader, activityOpen, route])
  useEffect(() => () => cancelMotion.current?.(), [])

  // The site header's Agents button. Offered only to a signed-in reader, for the same reason the
  // panel itself is, and only once the activity tracker has found something for them: an agent in
  // this site that the reader's account can see (owner, accepted collaborator, or a public agent),
  // or orphan agents of their own to adopt, which the button then flags with a dot. A mount
  // document the agent is not shared with them through is no reason to show a way into an empty
  // panel. It reflects what is on screen, not the stored preference: while Activity holds the slot
  // the button reads closed and a tap opens Agents (closing Activity), and on a narrow viewport a
  // restored "open" that is not showing reads closed for the same reason.
  const agentsOnScreen = (active === 'assistant' && !isMobile) || showFullScreen
  const [agents, setAgents] = useState<WebAssistantAgents>({usable: false, orphans: 0})
  const headerToggle = useMemo<AssistantPanelToggle | null>(
    () =>
      keyPair && (agents.usable || agents.orphans > 0)
        ? {isOpen: agentsOnScreen, toggle: agentsOnScreen ? panel.close : panel.open, orphans: agents.orphans}
        : null,
    [keyPair, agents, agentsOnScreen, panel.close, panel.open],
  )

  return (
    <ActivityPanelProvider>
      <div
        ref={groupRef}
        className={cn('flex w-full flex-row items-stretch', dragging && 'cursor-col-resize select-none')}
      >
        {keyPair ? (
          <ClientOnly>
            <SiteContextScope>
              <Suspense fallback={null}>
                <WebAssistantActivity onAgentsChange={setAgents} />
              </Suspense>
            </SiteContextScope>
          </ClientOnly>
        ) : null}
        <AssistantPanelToggleContext.Provider value={headerToggle}>
          <div className="min-w-0 flex-1">{children}</div>
        </AssistantPanelToggleContext.Provider>
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            aria-hidden={!showSidePanel || undefined}
            aria-valuemin={MIN_WIDTH_PX}
            aria-valuemax={Math.max(
              MIN_WIDTH_PX,
              typeof window === 'undefined' ? MIN_WIDTH_PX : window.innerWidth * MAX_WIDTH_FRACTION,
            )}
            aria-valuenow={width}
            tabIndex={showSidePanel ? 0 : -1}
            style={showSidePanel ? undefined : {display: 'none'}}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Enter') return
              event.preventDefault()
              cancelMotion.current?.()
              if (event.key === 'Enter') {
                const group = groupRef.current!
                group.tabIndex = -1
                group.focus({preventScroll: true})
                if (active === 'activity') closeActivity(false)
                else panel.close()
              } else setWidth(width + (event.key === 'ArrowLeft' ? 10 : -10))
            }}
            className={cn('panel-resize-handle visible sticky top-0 h-dvh shrink-0 self-start', dragging && 'active')}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <aside
            ref={asideRef}
            data-panel-width
            aria-hidden={!showSidePanel || undefined}
            aria-label={active === 'assistant' ? 'Agents' : 'Activity'}
            data-testid="web-side-panel"
            className="bg-background border-border sticky top-0 flex h-dvh shrink-0 flex-col self-start overflow-hidden"
            style={{width: shown ? width : 0}}
          >
            {!isMobile && (showSidePanel || hasOpened) ? (
              <div className="h-full border-l">
                <SidePanelSlotContent
                  active={active}
                  panels={{
                    activity: {render: () => <ActivityPanelOutlet />},
                    // The assistant stays mounted once shown so its chat survives switching to
                    // Activity.
                    assistant: {
                      keepMounted: true,
                      render: () => (keyPair ? <PanelBody showClose visible={active === 'assistant'} /> : null),
                    },
                  }}
                />
              </div>
            ) : null}
          </aside>
        </>
        {showFullScreen ? <FullScreenPanel onBack={panel.close} /> : null}
      </div>
    </ActivityPanelProvider>
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
 * The current page's contexts, re-provided above the outlet for what lives there. The activity
 * tracker needs them to see the server the space in view advertises; before any page has
 * published it runs without, on the configured servers alone.
 */
function SiteContextScope({children}: {children: React.ReactNode}) {
  const site = useSiteContextSnapshot()
  if (!site) return <>{children}</>
  return (
    <UniversalAppContext.Provider value={site.universal}>
      <NavContextProvider value={site.navigation}>{children}</NavContextProvider>
    </UniversalAppContext.Provider>
  )
}

/**
 * The lazy panel under the current page's contexts. Before any page has published (first paint,
 * or a page outside the site shell) the panel has nothing to navigate with, so it waits.
 */
function PanelBody({showClose, visible = true}: {showClose?: boolean; visible?: boolean}) {
  const site = useSiteContextSnapshot()
  if (!site) return <PanelLoading />
  return (
    <UniversalAppContext.Provider value={site.universal}>
      <NavContextProvider value={site.navigation}>
        <Suspense fallback={<PanelLoading />}>
          <WebAssistantPanelContent showClose={showClose} visible={visible} />
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
