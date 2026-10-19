import {
  getProfileAvatarImageSrc,
  getProfileDisplayName,
  type AccountProfileSummary,
  type ProfileLoadState,
} from '@/frontend/profile'
import {cn} from '@/frontend/utils'
import {Check, User} from 'lucide-react'

/** A selectable account row for picking which account to continue with. */
export function AccountSelectionItem({
  profile,
  profileLoadState,
  backendHttpBaseUrl,
  isSelected,
  onClick,
}: {
  profile?: AccountProfileSummary
  profileLoadState?: ProfileLoadState
  backendHttpBaseUrl: string
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        isSelected ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5',
      )}
      onClick={onClick}
    >
      <div className="bg-primary/10 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
        {profile?.avatar ? (
          <img
            src={getProfileAvatarImageSrc(backendHttpBaseUrl, profile.avatar)}
            className="size-full object-cover"
            alt=""
          />
        ) : (
          <User className="text-primary size-5" />
        )}
      </div>
      <div
        className={cn(
          'flex-1 truncate text-sm font-semibold',
          profileLoadState === 'not_found' && 'text-yellow-700 dark:text-yellow-400',
          profileLoadState === 'unavailable' && 'text-destructive',
        )}
      >
        {getProfileDisplayName(profile, profileLoadState)}
      </div>
      {isSelected ? <Check className="text-brand size-4 shrink-0" /> : null}
    </button>
  )
}
