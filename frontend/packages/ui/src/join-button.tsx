import {CircleUser} from 'lucide-react'
import {Button} from './button'

export interface JoinButtonProps {
  onClick: () => void
  disabled?: boolean
  /** 'header' renders as a branded header button, 'floating' as a shadowed floating button */
  variant?: 'header' | 'floating'
}

/**
 * Shared Join button component used on both web and desktop.
 * - Web: triggers account creation
 * - Desktop: triggers saving site as contact
 */
export function JoinButton({onClick, disabled, variant = 'floating'}: JoinButtonProps) {
  if (variant === 'header') {
    return (
      <Button
        variant="brand"
        size="sm"
        className="plausible-event-name=click-join-button text-white"
        onClick={onClick}
        disabled={disabled}
      >
        Join
      </Button>
    )
  }

  return (
    <button
      className="flex items-center gap-2 rounded-lg bg-white p-2 font-bold shadow-lg transition-colors hover:bg-gray-100 dark:bg-gray-800"
      onClick={onClick}
      disabled={disabled}
    >
      <CircleUser className="size-4" />
      Join
    </button>
  )
}
