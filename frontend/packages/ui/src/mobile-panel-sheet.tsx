import {ReactNode, useCallback, useEffect} from 'react'
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
  // Lock body scroll while the sheet is open, and clean up on unmount
  // to prevent the user from getting stuck with a non-scrollable page.
  useEffect(() => {
    if (!isOpen) return
    const html = document.documentElement
    const prevOverflow = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevOverflow
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
      className={cn(
        'bg-background fixed inset-0 z-50 flex h-dvh max-h-dvh flex-1 flex-col overflow-hidden',
        'transition-transform duration-200 ease-[cubic-bezier(0,1,0.15,1)]',
        isOpen ? 'translate-y-0' : 'pointer-events-none translate-y-full',
      )}
    >
      {/* Header */}
      <div className="border-border flex shrink-0 items-center border-b px-3 py-2 text-left">
        <Text weight="semibold" className="flex-1">
          {title}
        </Text>

        <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
          <Close className="size-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
    </div>,
    document.body,
  )
}
