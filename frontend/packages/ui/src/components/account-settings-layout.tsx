import {Import, Plus, Vault} from 'lucide-react'
import {type ReactNode} from 'react'
import {cn} from '../utils'

export type AccountSettingsAccount = {
  id: string
  name: string
  /** Rendered avatar/icon for the account (platform provides HMIcon, an <img>, etc.). */
  icon: ReactNode
}

/**
 * Shared account-settings shell used by both the desktop app and the web vault:
 * a left sidebar (Vault Settings entry + selectable account list + Add account /
 * Import key) and a detail pane (`children`).
 *
 * Routing-agnostic: the platform wires `onSelect*` to its own router (the desktop
 * nav route, or react-router on the web) so every state gets a real URL, and
 * passes the resulting `selectedAccountId` / `isVaultSelected` back in.
 */
export function AccountSettingsLayout({
  accounts,
  selectedAccountId,
  isVaultSelected,
  onSelectVault,
  onSelectAccount,
  onAddAccount,
  onImportKey,
  children,
}: {
  accounts: AccountSettingsAccount[]
  selectedAccountId: string | null
  isVaultSelected: boolean
  onSelectVault: () => void
  onSelectAccount: (id: string) => void
  onAddAccount?: () => void
  onImportKey?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="bg-sidebar flex w-[260px] shrink-0 flex-col border-r border-black/10 dark:border-white/10">
        <div className="border-b border-black/10 p-2 dark:border-white/10">
          <SidebarItem
            icon={
              <div className="bg-muted flex size-7 items-center justify-center rounded-full">
                <Vault className="size-4" />
              </div>
            }
            label="Vault Settings"
            active={isVaultSelected}
            onClick={onSelectVault}
          />
        </div>

        <div className="px-4 py-3">
          <p className="text-muted-foreground text-xs font-bold tracking-wider uppercase">Accounts</p>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {accounts.map((account) => (
            <SidebarItem
              key={account.id}
              icon={account.icon}
              label={account.name}
              active={!isVaultSelected && account.id === selectedAccountId}
              onClick={() => onSelectAccount(account.id)}
            />
          ))}
        </div>

        {onAddAccount || onImportKey ? (
          <div className="flex flex-col gap-1 border-t border-black/10 p-2 dark:border-white/10">
            {onAddAccount ? (
              <SidebarAction icon={<Plus className="size-4" />} label="Add account" onClick={onAddAccount} />
            ) : null}
            {onImportKey ? (
              <SidebarAction icon={<Import className="size-4" />} label="Import key" onClick={onImportKey} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
      )}
    >
      <div className="shrink-0">{icon}</div>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
    </button>
  )
}

function SidebarAction({icon, label, onClick}: {icon: ReactNode; label: string; onClick: () => void}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5"
    >
      <div className="bg-muted flex size-7 items-center justify-center rounded-full">{icon}</div>
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}
