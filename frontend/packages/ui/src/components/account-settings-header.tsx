import {ExternalLink} from 'lucide-react'
import {type ReactNode} from 'react'
import {Button} from '../button'

/**
 * Shared header for the account-settings detail pane (above the tabs): the
 * account's icon + name on the left, and an "Open Profile" button on the right.
 * Routing-agnostic — the platform wires `onOpenProfile` to its own navigation
 * (desktop opens the in-app profile; the web vault opens the public profile).
 */
export function AccountSettingsHeader({
  icon,
  name,
  onOpenProfile,
}: {
  icon: ReactNode
  name: string
  onOpenProfile?: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">{icon}</div>
      <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{name}</h1>
      {onOpenProfile ? (
        <Button variant="outline" className="shrink-0" onClick={onOpenProfile}>
          Open Profile
          <ExternalLink className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}
