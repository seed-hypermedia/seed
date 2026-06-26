import {AccountNotificationsSection} from '@/frontend/components/AccountNotificationsSection'
import {CreateAccountDialog} from '@/frontend/components/CreateAccountDialog'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {getProfileAvatarImageSrc, getProfileDisplayName} from '@/frontend/profile'
import {useActions, useAppState} from '@/frontend/store'
import * as vault from '@/frontend/vault'
import * as blobs from '@shm/shared/blobs'
import {AccountSettingsLayout} from '@shm/ui/components/account-settings-layout'
import {AccountSettingsTabs, type AccountSettingsTab} from '@shm/ui/components/account-settings-tabs'
import {ImportKeyDialog} from '@shm/ui/components/import-key-dialog'
import {Copy, Monitor, Smartphone, Tablet} from 'lucide-react'
import {useEffect, useState, type ReactNode} from 'react'
import {useLocation, useNavigate, useParams} from 'react-router-dom'
import {SettingsView} from './SettingsView'

/**
 * The unlocked web vault UI: a shared account-settings layout (account sidebar +
 * per-account tabs + Vault Settings), backed by the vault store and routed via
 * react-router so every state has a URL (/, /accounts/:id, /accounts/:id/:tab,
 * /settings).
 */
export function AccountSettingsView() {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const actions = useActions()
  const {vaultData, profiles, profileLoadStates, backendHttpBaseUrl, session, notificationServerUrl} = useAppState()

  const accounts = vaultData?.accounts ?? []
  const accountList = accounts.map((account, index) => {
    const kp = blobs.nobleKeyPairFromSeed(account.seed)
    const principal = blobs.principalToString(kp.principal)
    return {principal, account, index}
  })
  const accountsKey = accountList.map((a) => a.principal).join(',')

  const isVaultSelected = location.pathname === '/settings'
  const selectedAccountId = params.accountId ? decodeURIComponent(params.accountId) : null
  const tab = (params.tab as AccountSettingsTab) || 'account'
  const selected = accountList.find((a) => a.principal === selectedAccountId) ?? null

  const [importOpen, setImportOpen] = useState(false)

  // Load profile metadata for each account (names + avatars).
  useEffect(() => {
    accountList.forEach((a) => void actions.ensureProfileLoaded(a.principal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey])

  // Keep the store's selected index in sync so account-scoped actions target the
  // account shown in the URL.
  useEffect(() => {
    if (selected) actions.selectAccount(selected.index)
  }, [selected?.index, actions])

  // The bare "/" landing redirects to a concrete URL (first account, or settings).
  useEffect(() => {
    if (location.pathname !== '/') return
    const first = accountList[0]
    if (first) {
      navigate(`/accounts/${encodeURIComponent(first.principal)}`, {replace: true})
    } else {
      navigate('/settings', {replace: true})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, accountsKey])

  const sidebarAccounts = accountList.map((a) => {
    const profile = profiles[a.principal]
    const name = getProfileDisplayName(profile, profileLoadStates[a.principal])
    return {
      id: a.principal,
      name,
      icon: <AccountAvatar avatar={profile?.avatar} name={name} backendHttpBaseUrl={backendHttpBaseUrl} />,
    }
  })

  const effectiveNotifyUrl = vaultData?.notificationServerUrl?.trim() || notificationServerUrl
  const sessionEmail = session?.email?.trim() || ''

  return (
    <div className="bg-card flex h-[640px] w-full overflow-hidden rounded-xl border max-md:h-auto max-md:min-h-[480px] max-md:flex-col">
      <AccountSettingsLayout
        accounts={sidebarAccounts}
        selectedAccountId={selectedAccountId}
        isVaultSelected={isVaultSelected}
        onSelectVault={() => navigate('/settings')}
        onSelectAccount={(id) => navigate(`/accounts/${encodeURIComponent(id)}`)}
        onAddAccount={() => actions.setCreatingAccount(true)}
        onImportKey={() => setImportOpen(true)}
      >
        {isVaultSelected ? (
          <SettingsView />
        ) : selected ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
            <h1 className="text-2xl font-semibold">Account Settings</h1>
            <AccountSettingsTabs
              activeTab={tab}
              onTabChange={(nextTab) =>
                navigate(`/accounts/${encodeURIComponent(selected.principal)}/${nextTab}`)
              }
            />
            {tab === 'account' ? <AccountTabContent principal={selected.principal} /> : null}
            {tab === 'notifications' ? (
              <AccountNotificationsSection
                seed={selected.account.seed}
                accountCreateTime={selected.account.createTime}
                notificationServerUrl={effectiveNotifyUrl}
                sessionEmail={sessionEmail}
              />
            ) : null}
            {tab === 'devices' ? <DevicesTabContent account={selected.account as vault.Account} /> : null}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center p-8">No account selected.</div>
        )}
      </AccountSettingsLayout>

      <CreateAccountDialog />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}

function AccountAvatar({
  avatar,
  name,
  backendHttpBaseUrl,
}: {
  avatar?: string
  name: string
  backendHttpBaseUrl: string
}) {
  const src = avatar ? getProfileAvatarImageSrc(backendHttpBaseUrl, avatar) : ''
  if (src) {
    return <img src={src} alt="" className="size-7 rounded-full object-cover" />
  }
  return (
    <div className="bg-muted flex size-7 items-center justify-center rounded-full text-xs font-medium">
      {(name || '?')[0]?.toUpperCase()}
    </div>
  )
}

function AccountTabContent({principal}: {principal: string}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Account ID</p>
          <p className="text-muted-foreground truncate font-mono text-xs">{principal}</p>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(principal)
          }}
        >
          <Copy className="size-4" />
          Copy
        </button>
      </div>
    </div>
  )
}

function DevicesTabContent({account}: {account: vault.Account}) {
  const sessions = account.delegations || []
  if (!sessions.length) {
    return (
      <div className="border-border flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-8 text-center">
        <p className="font-medium">No delegated keys</p>
        <p className="text-muted-foreground text-sm">Sessions you authorize on other devices will appear here.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => {
        const delegatePrincipal = blobs.principalToString(session.capability.delegate)
        const DeviceIcon = session.deviceType === 'mobile' ? Smartphone : session.deviceType === 'tablet' ? Tablet : Monitor
        return (
          <div key={`${session.clientId}:${delegatePrincipal}`} className="flex items-center gap-3 rounded-xl border p-4">
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
              <DeviceIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{session.clientId}</p>
              <p className="text-muted-foreground truncate font-mono text-xs">{delegatePrincipal}</p>
            </div>
            <p className="text-muted-foreground shrink-0 text-xs">{new Date(session.createTime).toLocaleDateString()}</p>
          </div>
        )
      })}
    </div>
  )
}

function ImportDialog({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}): ReactNode {
  const actions = useActions()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  useEffect(() => {
    if (!open) setSelectedFile(null)
  }, [open])

  return (
    <ImportKeyDialog
      open={open}
      onOpenChange={onOpenChange}
      hasFile={!!selectedFile}
      renderFileField={({clearError}) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-key-file">Key File</Label>
          <Input
            id="import-key-file"
            type="file"
            accept=".hmkey.json,application/json"
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] ?? null)
              clearError()
            }}
          />
          {selectedFile ? <p className="text-muted-foreground text-sm break-all">{selectedFile.name}</p> : null}
        </div>
      )}
      onImport={async (password) => {
        if (!selectedFile) throw new Error('Key file is required')
        const contents = await selectedFile.text()
        await actions.importAccount(contents, password)
      }}
    />
  )
}
