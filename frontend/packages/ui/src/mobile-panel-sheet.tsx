import * as Dialog from '@radix-ui/react-dialog'
import type {ReactNode, PointerEvent as ReactPointerEvent} from 'react'
import {cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {PanelHeader} from './panel-header'
import {cn} from './utils'

export interface MobilePanelSheetProps {
  /** Whether the panel is open */
  isOpen: boolean
  /** Panel title */
  title: string
  /** Optional total shown beside the title. */
  count?: number
  /** Open the panel selection in a full-page view. */
  onExpand?: () => void
  /** Callback when close button is clicked */
  onClose: () => void
  /** Panel content */
  children: ReactNode
  /** Replaces the title row for panels with their own controls, including their own close button. */
  header?: ReactNode
  /** Opens the panel at about 65% of the screen and lets the reader drag between that and full height. */
  resizable?: boolean
  /** Return from a thread to the comments list. */
  onBack?: () => void
  /** Let simple panels scroll here; comments and feeds own their scroll area. */
  scrollContent?: boolean
}

/** The heights a resizable sheet rests at. */
export type SheetSnap = 'partial' | 'full'

const FLICK_VELOCITY = 0.5
// Movement before a press on the header counts as a drag, so taps on its buttons still work.
const DRAG_START_DISTANCE = 6

/**
 * Where a resizable sheet goes on drag end
 */
export function resolveSheetSnap({
  height,
  velocity,
  startSnap,
  partialHeight,
  fullHeight,
  closeDistance,
}: {
  height: number
  velocity: number
  startSnap: SheetSnap
  partialHeight: number
  fullHeight: number
  closeDistance: number
}): SheetSnap | 'close' {
  if (velocity > FLICK_VELOCITY) return 'full'
  if (velocity < -FLICK_VELOCITY) return startSnap === 'full' && height > partialHeight ? 'partial' : 'close'
  if (height < partialHeight - closeDistance) return 'close'
  return height - partialHeight < fullHeight - height ? 'partial' : 'full'
}

export function MobilePanelSheet({
  isOpen,
  title,
  count,
  onExpand,
  onClose,
  children,
  header,
  resizable = false,
  onBack,
  scrollContent = true,
}: MobilePanelSheetProps) {
  const titleId = useId()
  const [isVisible, setIsVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [viewport, setViewport] = useState<{height: number; top: number} | null>(() =>
    typeof window === 'undefined'
      ? null
      : {
          height: window.visualViewport?.height ?? window.innerHeight,
          top: window.visualViewport?.offsetTop ?? 0,
        },
  )
  const returnFocus = useRef<HTMLElement | null>(null)
  const requestClose = useCallback(() => {
    if (!isVisible || window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose()
    else setClosing(true)
  }, [onClose, isVisible])

  useEffect(() => {
    if (!isOpen) return
    setClosing(false)
    const visualViewport = window.visualViewport
    const update = () =>
      setViewport({
        height: visualViewport?.height ?? window.innerHeight,
        top: visualViewport?.offsetTop ?? 0,
      })
    update()
    visualViewport?.addEventListener('resize', update)
    visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      visualViewport?.removeEventListener('resize', update)
      visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [isOpen])
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!closing) return
    let cancelled = false
    // A close during the first frame may have no transition to wait for.
    const animations = sheetRef.current?.getAnimations?.() ?? []
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) onClose()
    })
    return () => {
      cancelled = true
    }
  }, [closing, onClose])
  const [snap, setSnap] = useState<SheetSnap>('partial')
  // The sheet's height while it's being dragged. Between drags it rests at its snap height.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const resize = useRef<{
    pointerId: number
    startY: number
    startHeight: number
    fullHeight: number
    isDragging: boolean
    lastY: number
    lastTime: number
    velocity: number
  } | null>(null)
  const suppressHandleClick = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      setIsVisible(false)
      setDragY(0)
      setIsDragging(false)
      return
    }

    const frame = requestAnimationFrame(() => setIsVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [isOpen])

  // Lock body scroll while the sheet is open, and clean up on unmount
  // to prevent the user from getting stuck with a non-scrollable page.
  useEffect(() => {
    if (!isOpen) return
    const html = document.documentElement
    const body = document.body
    const scrollY = window.scrollY
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevBodyPosition = body.style.position
    const prevBodyTop = body.style.top
    const prevBodyWidth = body.style.width
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      body.style.position = prevBodyPosition
      body.style.top = prevBodyTop
      body.style.width = prevBodyWidth
      window.scrollTo(0, scrollY)
    }
  }, [isOpen])

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    dragStartY.current = event.clientY
    setIsDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [])

  const handleDragMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isDragging) return
      const nextY = event.clientY - dragStartY.current
      setDragY(nextY < 0 ? Math.max(nextY * 0.25, -24) : nextY)
    },
    [isDragging],
  )

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    const closeThreshold = Math.min(160, window.innerHeight * 0.18)
    if (dragY > closeThreshold) {
      requestClose()
    }
    setDragY(0)
  }, [dragY, isDragging, requestClose])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current
    const overlay = sheet?.parentElement
    if (!sheet || !overlay || event.button > 0) return
    suppressHandleClick.current = false
    const overlayPadding = parseFloat(getComputedStyle(overlay).paddingTop) || 0
    resize.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sheet.getBoundingClientRect().height,
      fullHeight: overlay.clientHeight - overlayPadding,
      isDragging: false,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    }
  }, [])

  const handleResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resize.current
    if (!state || state.pointerId !== event.pointerId) return
    const delta = state.startY - event.clientY
    if (!state.isDragging) {
      if (Math.abs(delta) < DRAG_START_DISTANCE) return
      state.isDragging = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    const elapsed = event.timeStamp - state.lastTime
    if (elapsed > 0) state.velocity = (state.lastY - event.clientY) / elapsed
    state.lastY = event.clientY
    state.lastTime = event.timeStamp
    const height = state.startHeight + delta
    // Soft boundary above full height: the sheet resists, then stops.
    setDragHeight(
      height > state.fullHeight ? state.fullHeight + Math.min((height - state.fullHeight) * 0.25, 24) : height,
    )
  }, [])

  const handleResizeEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = resize.current
      resize.current = null
      if (!state?.isDragging) return
      suppressHandleClick.current = true
      const target = resolveSheetSnap({
        height: dragHeight ?? state.startHeight,
        // A pause before letting go isn't a flick.
        velocity: event.timeStamp - state.lastTime > 100 ? 0 : state.velocity,
        startSnap: snap,
        partialHeight: (viewport?.height ?? window.innerHeight) * 0.65,
        fullHeight: state.fullHeight,
        closeDistance: Math.min(160, window.innerHeight * 0.18),
      })
      setDragHeight(null)
      if (target === 'close') requestClose()
      else setSnap(target)
    },
    [dragHeight, snap, requestClose, viewport],
  )

  const keyboardOpen = viewport !== null && viewport.height < window.innerHeight * 0.75
  const sheetHeight =
    dragHeight !== null
      ? `${Math.max(0, dragHeight)}px`
      : snap === 'full' || keyboardOpen
        ? '100%'
        : `${(viewport?.height ?? 0) * 0.65}px`

  // Portal to document.body to escape ancestor transforms (e.g. transform-gpu on SiteHeader)
  // which break position:fixed by creating a new containing block.
  return createPortal(
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <div
        data-slot="mobile-panel-overlay"
        style={viewport ? {height: viewport.height, top: viewport.top, bottom: 'auto'} : undefined}
        className={cn(
          'fixed inset-0 z-50 flex h-dvh items-end justify-center overflow-hidden bg-black/25 pt-10 backdrop-blur-[2px]',
          'transition-opacity duration-300 ease-(--ease-out-smooth) motion-reduce:transition-none',
          isOpen
            ? `pointer-events-auto ${isVisible && !closing ? 'opacity-100' : 'opacity-0'}`
            : 'pointer-events-none opacity-0',
        )}
      >
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            returnFocus.current = document.activeElement as HTMLElement
            sheetRef.current?.focus({preventScroll: true})
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus({preventScroll: true})
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={header ? undefined : titleId}
          aria-label={header ? title : undefined}
          data-slot="mobile-panel-sheet"
          data-snap={resizable ? snap : undefined}
          ref={sheetRef}
          onClick={(event) => event.stopPropagation()}
          style={{
            transform: isOpen && isVisible && !closing ? `translateY(${dragY}px)` : 'translateY(100%)',
            ...(resizable ? {height: sheetHeight, maxHeight: '100%'} : {}),
          }}
          className={cn(
            'bg-background border-border flex w-full flex-col overflow-hidden rounded-t-3xl border-t shadow-[0_-20px_60px_rgba(0,0,0,0.22)] outline-none',
            !resizable && 'h-[90dvh] max-h-[90dvh]',
            'will-change-transform motion-reduce:transition-none',
            isDragging || dragHeight !== null
              ? 'transition-none'
              : resizable
                ? 'transition-[transform,height] duration-300 ease-(--ease-out-smooth)'
                : 'transition-transform duration-300 ease-(--ease-out-smooth)',
          )}
        >
          {/* A resizable sheet drags by its handle and header. Non-resizable only by the handle, to close. */}
          <div
            className={cn('flex shrink-0 flex-col', resizable && 'touch-none')}
            onPointerDown={resizable ? handleResizeStart : undefined}
            onPointerMove={resizable ? handleResizeMove : undefined}
            onPointerUp={resizable ? handleResizeEnd : undefined}
            onPointerCancel={() => {
              resize.current = null
              setDragHeight(null)
            }}
          >
            <div className="flex shrink-0 justify-center pt-2">
              <button
                type="button"
                aria-label={resizable ? (snap === 'full' ? 'Shrink panel' : 'Expand panel') : 'Drag panel'}
                data-slot="mobile-panel-drag-handle"
                onClick={(event) => {
                  event.stopPropagation()
                  if (!resizable) return
                  // A drag that ends on the handle isn't a tap.
                  if (suppressHandleClick.current) {
                    suppressHandleClick.current = false
                    return
                  }
                  setSnap(snap === 'full' ? 'partial' : 'full')
                }}
                onPointerDown={resizable ? undefined : handleDragStart}
                onPointerMove={resizable ? undefined : handleDragMove}
                onPointerUp={resizable ? undefined : handleDragEnd}
                onPointerCancel={() => {
                  setIsDragging(false)
                  setDragY(0)
                }}
                className="cursor-grab touch-none rounded-full px-6 py-2 active:cursor-grabbing"
              >
                <span aria-hidden="true" className="bg-muted-foreground/30 block h-1.5 w-12 rounded-full" />
              </button>
            </div>

            <Dialog.Title className="sr-only">{onBack ? 'Thread' : title}</Dialog.Title>
            {(isValidElement<{onClose?: () => void}>(header)
              ? cloneElement(header, {onClose: requestClose})
              : header) ?? (
              <PanelHeader
                title={onBack ? 'Thread' : title}
                titleId={titleId}
                count={onBack ? undefined : count}
                onBack={onBack}
                onExpand={onExpand}
                onClose={requestClose}
              />
            )}
          </div>

          {/* Content */}
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col overscroll-contain pb-[env(safe-area-inset-bottom)]',
              scrollContent ? 'overflow-y-auto' : 'overflow-hidden',
            )}
          >
            {children}
          </div>
        </Dialog.Content>
      </div>
    </Dialog.Root>,
    document.body,
  )
}
