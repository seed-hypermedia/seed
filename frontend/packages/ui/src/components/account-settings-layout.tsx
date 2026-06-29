import {Copy, Import, KeyRound, MoreHorizontal, Pencil, Plus, Trash, Vault} from 'lucide-react'
import {type ReactNode} from 'react'
import {cn} from '../utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'

/** Per-account options exposed via the row's 3-dots menu. */
export type AccountSettingsAccountMenu = {
  onEditProfile: () => void
  onCopyId: () => void
  onExportKey: () => void
  onDelete: () => void
}

export type AccountSettingsAccount = {
  id: string
  name: string
  /** Rendered avatar/icon for the account (platform provides HMIcon, an <img>, etc.). */
  icon: ReactNode
  /** Optional per-account options menu (Copy account ID / Export key / Delete account). */
  menu?: AccountSettingsAccountMenu
}

/**
 * Shared account-settings shell used by both the desktop app and the web vault:
 * a left sidebar (Identity Settings entry + selectable account list + Add account /
 * Import identity) and a detail pane (`children`).
 *
 * Routing-agnostic: the platform wires `onSelect*` to its own router (the desktop
 * nav route, or react-router on the web) so every state gets a real URL, and
 * passes the resulting `selectedAccountId` / `isVaultSelected` back in.
 */
export function AccountSettingsLayout({
  accounts,
  selectedAccountId,
  isVaultSelected,
  vaultEmail,
  onSelectVault,
  onSelectAccount,
  onAddAccount,
  onImportKey,
  children,
}: {
  accounts: AccountSettingsAccount[]
  selectedAccountId: string | null
  isVaultSelected: boolean
  /** Email shown under the Identity Settings entry (the signed-in remote vault email). */
  vaultEmail?: string
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
            label="Identity Settings"
            sublabel={vaultEmail}
            active={isVaultSelected}
            onClick={onSelectVault}
          />
        </div>

        <div className="px-4 py-3">
          <p className="text-muted-foreground text-xs font-bold tracking-wider uppercase">Accounts</p>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
          {accounts.map((account) => (
            <SidebarItem
              key={account.id}
              icon={account.icon}
              label={account.name}
              active={!isVaultSelected && account.id === selectedAccountId}
              onClick={() => onSelectAccount(account.id)}
              menu={account.menu}
            />
          ))}
          {onAddAccount ? (
            <button
              onClick={onAddAccount}
              className="text-muted-foreground hover:text-foreground flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
            >
              <div className="border-muted-foreground/40 flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed">
                <Plus className="size-4" />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">Add account</span>
            </button>
          ) : null}
        </div>

        {onImportKey ? (
          <div className="flex flex-col gap-1 p-2">
            <SidebarAction icon={<Import className="size-4" />} label="Import identity" onClick={onImportKey} />
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
  sublabel,
  active,
  onClick,
  menu,
}: {
  icon: ReactNode
  label: string
  sublabel?: string
  active: boolean
  onClick: () => void
  menu?: AccountSettingsAccountMenu
}) {
  return (
    <div className="group/account relative">
      <button
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left',
          menu ? 'pr-9' : '',
          active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
        )}
      >
        <div className="shrink-0">{icon}</div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{label}</span>
          {sublabel ? (
            <span className={cn('truncate text-xs', active ? 'opacity-80' : 'text-muted-foreground')}>{sublabel}</span>
          ) : null}
        </div>
      </button>
      {menu ? <AccountOptionsMenu menu={menu} /> : null}
    </div>
  )
}

/** The hover-revealed 3-dots options menu for an account row. */
function AccountOptionsMenu({menu}: {menu: AccountSettingsAccountMenu}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account options"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md',
          'opacity-0 group-hover/account:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
          'hover:bg-black/10 dark:hover:bg-white/10',
        )}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom">
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation()
            menu.onEditProfile()
          }}
        >
          <Pencil className="size-4" />
          Edit profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation()
            menu.onCopyId()
          }}
        >
          <Copy className="size-4" />
          Copy account ID
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation()
            menu.onExportKey()
          }}
        >
          <KeyRound className="size-4" />
          Export key
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={(event) => {
            event.stopPropagation()
            menu.onDelete()
          }}
        >
          <Trash className="size-4" />
          Delete account
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
