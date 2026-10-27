import {ExternalLink} from 'lucide-react'
import {Button} from '../button'
import {AccountSettingsTabs, type AccountSettingsTab} from './account-settings-tabs'

/**
 * Shared header for the account-settings detail pane: the settings tabs
 * (Notifications / Connected Devices) on the left and a "My Profile" button on
 * the right, all on one row. Routing-agnostic — the platform wires `onTabChange`
 * and `onOpenProfile` to its own navigation (desktop opens the in-app profile;
 * the web vault opens the public profile).
 */
export function AccountSettingsHeader({
  activeTab,
  onTabChange,
  onOpenProfile,
}: {
  activeTab: AccountSettingsTab
  onTabChange: (tab: AccountSettingsTab) => void
  onOpenProfile?: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <AccountSettingsTabs activeTab={activeTab} onTabChange={onTabChange} className="flex-1" />
      {onOpenProfile ? (
        <Button variant="green" className="shrink-0" onClick={onOpenProfile}>
          <ExternalLink className="size-4" />
          My Profile
        </Button>
      ) : null}
    </div>
  )
}
