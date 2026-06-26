import {Bell, MonitorSmartphone, User, type LucideIcon} from 'lucide-react'
import {Button} from '../button'
import {cn} from '../utils'

export type AccountSettingsTab = 'account' | 'notifications' | 'devices'

const TABS: {key: AccountSettingsTab; label: string; icon: LucideIcon}[] = [
  {key: 'account', label: 'Account', icon: User},
  {key: 'notifications', label: 'Notifications', icon: Bell},
  {key: 'devices', label: 'Devices', icon: MonitorSmartphone},
]

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
            className="flex-1 rounded-full"
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
