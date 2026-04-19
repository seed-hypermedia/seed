import {Button} from '@/frontend/components/ui/button'
import {Alert, AlertDescription, AlertTitle} from '@/frontend/components/ui/alert'
import {useActions, useAppState} from '@/frontend/store'
import {Bell, CheckCircle2, Plus, Shield, Upload, Users, X} from 'lucide-react'
import {useState} from 'react'
import {AccountsView} from './AccountsView'
import {NotificationsView} from './NotificationsView'
import {SettingsView} from './SettingsView'

type SidebarTab = 'accounts' | 'settings' | 'notifications'

export function VaultView({initialTab = 'accounts'}: {initialTab?: SidebarTab}) {
  const [activeTab, setActiveTab] = useState<SidebarTab>(initialTab)
  const actions = useActions()
  const {vaultConnectionSuccessMessage} = useAppState()
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)

  return (
    <div className="space-y-4">
      {vaultConnectionSuccessMessage && (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>Desktop app connected</AlertTitle>
          <AlertDescription className="pr-10">
            <p>{vaultConnectionSuccessMessage}</p>
            <p>You can manage or disconnect it later from the desktop app&apos;s Vault Backend settings.</p>
          </AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2"
            onClick={actions.clearVaultConnectionSuccessMessage}
            aria-label="Dismiss desktop app connected message"
          >
            <X className="size-4" />
          </Button>
        </Alert>
      )}

      <div className="bg-card flex min-h-[480px] overflow-hidden rounded-xl border max-md:flex-col">
        {/* Sidebar */}
        <div className="flex w-[220px] shrink-0 flex-col border-r max-md:w-full max-md:border-r-0 max-md:border-b">
          <div className="flex flex-1 flex-col gap-1 p-2">
            <SidebarButton
              active={activeTab === 'accounts'}
              icon={Users}
              label="Accounts"
              onClick={() => setActiveTab('accounts')}
            />
            <SidebarButton
              active={activeTab === 'settings'}
              icon={Shield}
              label="Security"
              onClick={() => setActiveTab('settings')}
            />
            <SidebarButton
              active={activeTab === 'notifications'}
              icon={Bell}
              label="Notifications"
              onClick={() => setActiveTab('notifications')}
            />
          </div>
          <div className="flex flex-col gap-2 border-t p-3">
            <Button
              variant="outline"
              className="w-full"
              size="sm"
              onClick={() => {
                setActiveTab('accounts')
                actions.setCreatingAccount(true)
              }}
            >
              <Plus className="size-4" />
              Create Account
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              size="sm"
              onClick={() => {
                setActiveTab('accounts')
                setIsImportDialogOpen(true)
              }}
            >
              <Upload className="size-4" />
              Import Key
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'accounts' && (
            <AccountsView isImportDialogOpen={isImportDialogOpen} onImportDialogChange={setIsImportDialogOpen} />
          )}
          {activeTab === 'settings' && <SettingsView />}
          {activeTab === 'notifications' && <NotificationsView />}
        </div>
      </div>
    </div>
  )
}

function SidebarButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ComponentType<{className?: string}>
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
        active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'
      }`}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
