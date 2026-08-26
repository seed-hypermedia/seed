import {useCallback, useEffect, useId, useRef, useState} from 'react'
import type {PointerEvent as ReactPointerEvent, ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {Button} from './button'
import {Close} from './icons'
import {Text} from './text'
import {cn} from './utils'

export interface MobilePanelSheetProps {
  /** Whether the panel is open */
  isOpen: boolean
  /** Panel title */
  title: string
  /** Callback when close button is clicked */
  onClose: () => void
  /** Panel content */
  children: ReactNode
}

export function MobilePanelSheet({isOpen, title, onClose, children}: MobilePanelSheetProps) {
  const titleId = useId()
  const [isVisible, setIsVisible] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)

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

  // Close on Escape key so the user is never stuck with the panel open
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

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
      onClose()
    }
    setDragY(0)
  }, [dragY, isDragging, onClose])

  // Portal to document.body to escape ancestor transforms (e.g. transform-gpu on SiteHeader)
  // which break position:fixed by creating a new containing block.
  return createPortal(
    <div
      data-slot="mobile-panel-overlay"
      onClick={onClose}
      className={cn(
        'fixed inset-0 z-50 flex h-dvh items-end justify-center overflow-hidden bg-black/25 pt-10 backdrop-blur-[2px]',
        'transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        isOpen ? `pointer-events-auto ${isVisible ? 'opacity-100' : 'opacity-0'}` : 'pointer-events-none opacity-0',
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-slot="mobile-panel-sheet"
        onClick={(event) => event.stopPropagation()}
        style={{transform: isOpen && isVisible ? `translateY(${dragY}px)` : 'translateY(2rem)'}}
        className={cn(
          'bg-background border-border flex h-[90dvh] max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t shadow-[0_-20px_60px_rgba(0,0,0,0.22)]',
          'will-change-transform motion-reduce:transition-none',
          isDragging ? 'transition-none' : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        )}
      >
        <div className="flex shrink-0 justify-center pt-2">
          <button
            type="button"
            aria-label="Drag panel"
            data-slot="mobile-panel-drag-handle"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            className="cursor-grab touch-none rounded-full px-6 py-2 active:cursor-grabbing"
          >
            <span aria-hidden="true" className="bg-muted-foreground/30 block h-1.5 w-12 rounded-full" />
          </button>
        </div>

        {/* Header */}
        <div className="border-border flex shrink-0 items-center border-b px-4 py-2 text-left">
          <Text id={titleId} weight="semibold" className="flex-1">
            {title}
          </Text>

          <Button aria-label="Close panel" variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <Close className="size-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
