import {ReactNode} from 'react'
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

export function MobilePanelSheet({
  isOpen,
  title,
  onClose,
  children,
}: MobilePanelSheetProps) {
  return (
    <div
      className={cn(
        'bg-background fixed inset-0 z-50 flex h-dvh max-h-dvh flex-1 flex-col overflow-hidden',
        'transition-transform duration-200 ease-[cubic-bezier(0,1,0.15,1)]',
        isOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none',
      )}
    >
      {/* Header */}
      <div className="border-border flex shrink-0 items-center border-b px-3 py-2 text-left">
        <Text weight="semibold" className="flex-1">
          {title}
        </Text>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="shrink-0"
        >
          <Close className="size-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  )
}
