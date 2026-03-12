import {CircleUser} from 'lucide-react'

export interface JoinButtonProps {
  onClick: () => void
  disabled?: boolean
}

/**
 * Shared Join button component used on both web and desktop.
 * - Web: triggers account creation
 * - Desktop: triggers saving site as contact
 */
export function JoinButton({onClick, disabled}: JoinButtonProps) {
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
