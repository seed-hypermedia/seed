import {UserCheck, UserPlus} from 'lucide-react'

export interface FollowButtonProps {
  onClick: () => void
  disabled?: boolean
  isFollowing?: boolean
}

/**
 * Shared Follow button component used on both web and desktop.
 * Shows "Follow" when not following, "Following" when already following.
 */
export function FollowButton({onClick, disabled, isFollowing}: FollowButtonProps) {
  return (
    <button
      className="flex items-center gap-2 rounded-lg bg-white p-2 font-bold shadow-lg transition-colors hover:bg-gray-100 dark:bg-gray-800"
      onClick={onClick}
      disabled={disabled}
    >
      {isFollowing ? (
        <>
          <UserCheck className="size-4" />
          Following
        </>
      ) : (
        <>
          <UserPlus className="size-4" />
          Follow
        </>
      )}
    </button>
  )
}
