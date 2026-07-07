import {Bell, Lock, type LucideIcon} from 'lucide-react'
import {Button} from '../button'
import {cn} from '../utils'

export type AccountSettingsTab = 'devices' | 'notifications'

const TABS: {key: AccountSettingsTab; label: string; icon: LucideIcon}[] = [
  {key: 'devices', label: 'Connected Devices', icon: Lock},
  {key: 'notifications', label: 'Notifications', icon: Bell},
]

/** Human-readable label for each account-settings tab. */
export const ACCOUNT_SETTINGS_TAB_LABELS = Object.fromEntries(TABS.map((tab) => [tab.key, tab.label])) as Record<
  AccountSettingsTab,
  string
>

/**
 * Shared per-account tab bar (Account / Notifications / Devices), used by both
 * the desktop app and the web vault. Routing-agnostic: the platform wires
 * `onTabChange` to its router so each tab gets a real URL.
 */
export function AccountSettingsTabs({
  activeTab,
  onTabChange,
  className,
}: {
  activeTab: AccountSettingsTab
  onTabChange: (tab: AccountSettingsTab) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {TABS.map((tab) => {
        const Icon = tab.icon
        const active = activeTab === tab.key
        return (
          <Button
            key={tab.key}
            variant={active ? 'accent' : 'ghost'}
            className="rounded-full"
            onClick={() => onTabChange(tab.key)}
          >
            <Icon className="size-4" />
            <span className="truncate">{tab.label}</span>
          </Button>
        )
      })}
    </div>
  )
}
