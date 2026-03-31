import {Button} from './button'

export interface JoinButtonProps {
  onClick: () => void
  disabled?: boolean
}

/**
 * Shared Join button component used on both web and desktop.
 * - Web: triggers account creation or joins site
 * - Desktop: joins site and subscribes for P2P syncing
 */
export function JoinButton({onClick, disabled}: JoinButtonProps) {
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
