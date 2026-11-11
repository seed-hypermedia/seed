import {Button} from '@shm/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shm/ui/components/alert-dialog'
import {Badge} from '@shm/ui/components/badge'
import {Switch} from '@shm/ui/components/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {NOTICE_TONE_TEXT_CLASS} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {CircleUserRound, Package, Plus, Settings, Trash} from 'lucide-react'
import {AppsDialog} from './apps'
import {useState} from 'react'
import {useSelectedAccountId} from './account'
import {ManageAgentAccountsDialog, ModelProvidersDialog} from './dialogs'
import {
  getDefaultAgentServerUrl,
  LOCAL_AGENT_SERVER_LABEL,
  useAgentServerHealth,
  useAgentServerUrl,
  useConfiguredAgentServerUrls,
  useLocalAgentServerState,
  useLocalAgentServerUrl,
  useSetAgentServerUrl,
  useSetAgentServerUrls,
  useSetLocalAgentServerEnabled,
} from './models'
import {getAgentsPlatform} from './platform'

/**
 * Manages the configured app environments: add, remove, pick the default, and open each server's
 * Accounts and Providers dialogs. This is the only place those dialogs live; agents themselves
 * are made from a home document's New menu.
 */
export function AgentServersSettings() {
  // Edits apply to the persisted list only. The locally spawned server is shown separately below
  // because its URL is assigned at startup and must never be written to settings.
  const servers = useConfiguredAgentServerUrls()
  const localServerUrl = useLocalAgentServerUrl()
  const defaultServer = useAgentServerUrl()
  const setServers = useSetAgentServerUrls()
  const setDefaultServer = useSetAgentServerUrl()
  const builtInDefaultUrl = getDefaultAgentServerUrl()
  const [draftUrl, setDraftUrl] = useState(builtInDefaultUrl ?? '')
  const [isAddOpen, setIsAddOpen] = useState(false)
  // Server dialogs are signed by the selected account; without one they stay hidden.
  const selectedAccountId = useSelectedAccountId()
  const providersDialog = useAppDialog(ModelProvidersDialog)
  const manageAccountsDialog = useAppDialog(ManageAgentAccountsDialog)
  const appsDialog = useAppDialog(AppsDialog)
  const serverDialogs = selectedAccountId
    ? {
        onOpenAccounts: (serverUrl: string) => manageAccountsDialog.open({serverUrl, selectedAccountId}),
        onOpenProviders: (serverUrl: string) => providersDialog.open({serverUrl, selectedAccountId}),
        onOpenApps: (serverUrl: string) => appsDialog.open({serverUrl, selectedAccountId}),
      }
    : {}

  async function addServer() {
    try {
      const next = [...(servers.data || []), draftUrl]
      await setServers.mutateAsync(next)
      setDraftUrl(builtInDefaultUrl ?? '')
      setIsAddOpen(false)
      toast.success('App environment added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add app environment')
    }
  }

  async function removeServer(serverUrl: string) {
    try {
      const next = (servers.data || []).filter((url) => url !== serverUrl)
      await setServers.mutateAsync(next)
      toast.success('App environment removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove app environment')
    }
  }

  async function makeDefault(serverUrl: string) {
    try {
      await setDefaultServer.mutateAsync(serverUrl)
      toast.success('Default app environment updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update default app environment')
    }
  }

  return (
    <div className="flex flex-col gap-3 py-3">
      <SizableText size="sm" className="text-muted-foreground">
        The AI app environments your agents can run on. New agents are created from a home document's New menu.
      </SizableText>
      {providersDialog.content}
      {manageAccountsDialog.content}
      {appsDialog.content}
      <div className="flex flex-col gap-2">
        {localServerUrl.data ? (
          <AgentServerSettingsRow
            key={localServerUrl.data}
            serverUrl={localServerUrl.data}
            isDefault={defaultServer.data === localServerUrl.data}
            isLocal
            onMakeDefault={() => void makeDefault(localServerUrl.data!)}
            {...serverDialogs}
          />
        ) : null}
        {(servers.data || []).map((serverUrl) => (
          <AgentServerSettingsRow
            key={serverUrl}
            serverUrl={serverUrl}
            isDefault={defaultServer.data === serverUrl}
            onMakeDefault={() => void makeDefault(serverUrl)}
            onRemove={() => void removeServer(serverUrl)}
            {...serverDialogs}
          />
        ))}
        {!servers.data?.length && !localServerUrl.data ? (
          <SizableText size="sm" className="text-muted-foreground">
            No app environments configured.
          </SizableText>
        ) : null}
      </div>
      <LocalAgentServerSwitch />
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="self-start">
            <Plus className="size-4" />
            Add server
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add app environment</DialogTitle>
            <DialogDescription>Enter the URL of the app environment you want to connect to.</DialogDescription>
          </DialogHeader>
          <Input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder={builtInDefaultUrl ?? 'https://agents.example.com'}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addServer()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void addServer()} disabled={setServers.isLoading || !draftUrl.trim()}>
              Add server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Desktop only: runs or stops the bundled local app environment. Off unless the user (or an upgrade
 * that found agents in it) turned it on; the dev server the app attaches to cannot be switched.
 */
function LocalAgentServerSwitch() {
  const platform = getAgentsPlatform()
  const state = useLocalAgentServerState()
  const setEnabled = useSetLocalAgentServerEnabled()
  const builtInDefaultUrl = getDefaultAgentServerUrl()
  if (!platform.setLocalServerEnabled) return null
  const running = state.data?.t === 'attached' || state.data?.t === 'spawned'
  const attached = state.data?.t === 'attached'
  const defaultHost = builtInDefaultUrl ? builtInDefaultUrl.replace(/^https?:\/\//, '') : null
  return (
    <div className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <SizableText size="sm" weight="bold">
          Local app environment
        </SizableText>
        <SizableText size="xs" className="text-muted-foreground">
          {attached
            ? 'Attached to the app environment already running on this computer.'
            : state.data?.t === 'error'
              ? `Could not start: ${state.data.message}`
              : `Runs an app environment on this computer. Off by default${
                  defaultHost ? `; agents normally run on ${defaultHost}` : ''
                }.`}
        </SizableText>
      </div>
      <Switch
        aria-label="Run a local app environment"
        checked={running}
        disabled={attached || state.isLoading || setEnabled.isLoading}
        onCheckedChange={(checked) =>
          setEnabled.mutate(checked, {
            onError: (error) =>
              toast.error(error instanceof Error ? error.message : 'Could not change the local app environment'),
          })
        }
      />
    </div>
  )
}

function AgentServerSettingsRow({
  serverUrl,
  isDefault,
  isLocal = false,
  onMakeDefault,
  onRemove,
  onOpenAccounts,
  onOpenProviders,
  onOpenApps,
}: {
  serverUrl: string
  isDefault: boolean
  /** The desktop-managed server. Always present, so it has no remove action. */
  isLocal?: boolean
  onMakeDefault: () => void
  onRemove?: () => void
  /** The server's signing accounts dialog; absent without an account to sign with. */
  onOpenAccounts?: (serverUrl: string) => void
  /** The server's model providers dialog; absent without an account to sign with. */
  onOpenProviders?: (serverUrl: string) => void
  /** The apps installed on this environment, the installs the account sees and the catalog; absent without an account. */
  onOpenApps?: (serverUrl: string) => void
}) {
  const health = useAgentServerHealth(serverUrl)
  return (
    <div className="group border-border bg-background flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <SizableText size="sm" weight="bold" className="truncate">
            {isLocal ? LOCAL_AGENT_SERVER_LABEL : serverUrl}
          </SizableText>
          {isDefault ? <Badge variant="secondary">Default</Badge> : null}
        </div>
        <SizableText size="xs" className={health.isError ? NOTICE_TONE_TEXT_CLASS.warning : 'text-muted-foreground'}>
          {health.isLoading
            ? 'Checking…'
            : health.isError
              ? 'Unreachable'
              : `Online · uptime ${Math.floor((health.data?.uptime || 0) / 60)}m`}
        </SizableText>
      </div>
      <div className="flex shrink-0 gap-2">
        {onOpenAccounts ? (
          <Button variant="outline" size="sm" onClick={() => onOpenAccounts(serverUrl)}>
            <CircleUserRound className="size-4" />
            Accounts
          </Button>
        ) : null}
        {onOpenProviders ? (
          <Button variant="outline" size="sm" onClick={() => onOpenProviders(serverUrl)}>
            <Settings className="size-4" />
            Providers
          </Button>
        ) : null}
        {onOpenApps ? (
          <Button variant="outline" size="sm" onClick={() => onOpenApps(serverUrl)}>
            <Package className="size-4" />
            Apps
          </Button>
        ) : null}
        {isDefault ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={onMakeDefault}
            className="opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100"
          >
            Make default
          </Button>
        )}
        {isLocal ? null : (
          <AlertDialog>
            <Tooltip content="Remove app environment">
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Trash className="size-4" />
                  <span className="sr-only">Remove</span>
                </Button>
              </AlertDialogTrigger>
            </Tooltip>
            <AlertDialogPortal>
              <AlertDialogContent className="max-w-[500px] gap-4">
                <AlertDialogTitle className="text-2xl font-bold">Remove app environment</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to remove {serverUrl}? You can add it back later.
                </AlertDialogDescription>
                <div className="flex justify-end gap-3">
                  <AlertDialogCancel asChild>
                    <Button variant="ghost">Cancel</Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button variant="destructive" onClick={onRemove}>
                      Remove
                    </Button>
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialogPortal>
          </AlertDialog>
        )}
      </div>
    </div>
  )
}

/**
 * {@link AgentServersSettings} as a `useAppDialog` content component, for apps with no settings
 * window to navigate to.
 */
export function AgentServersDialog({}: {input: true; onClose: () => void}) {
  return (
    <div className="flex max-h-[78vh] w-full flex-col gap-1 overflow-y-auto">
      <DialogTitle>App environments</DialogTitle>
      <AgentServersSettings />
    </div>
  )
}
