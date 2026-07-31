import {ReactNode, useCallback, useEffect, useId, useState} from 'react'
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

  useEffect(() => {
    if (!isOpen) {
      setIsVisible(false)
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
    const prevOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevOverflow
      body.style.overflow = prevBodyOverflow
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

  // Portal to document.body to escape ancestor transforms (e.g. transform-gpu on SiteHeader)
  // which break position:fixed by creating a new containing block.
  return createPortal(
    <div
      data-slot="mobile-panel-overlay"
      onClick={onClose}
      className={cn(
        'fixed inset-0 z-50 flex h-dvh items-end justify-center overflow-hidden bg-black/25 pt-10 backdrop-blur-[2px]',
        'transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        isOpen && isVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-slot="mobile-panel-sheet"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'bg-background border-border flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t shadow-[0_-20px_60px_rgba(0,0,0,0.22)]',
          'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none',
          isOpen && isVisible ? 'translate-y-0' : 'translate-y-8',
        )}
      >
        <div className="flex shrink-0 justify-center pt-2">
          <div aria-hidden="true" className="bg-muted-foreground/30 h-1.5 w-12 rounded-full" />
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
