import {AccountNotificationsSection} from '@/frontend/components/AccountNotificationsSection'
import {AccountProfileDialog} from '@/frontend/components/AccountProfileDialog'
import {CreateAccountDialog} from '@/frontend/components/CreateAccountDialog'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {
  type AccountProfileSummary,
  getProfileAvatarImageSrc,
  getProfileDisplayName,
  type ProfileLoadState,
} from '@/frontend/profile'
import {useActions, useAppState} from '@/frontend/store'
import * as vault from '@/frontend/vault'
import * as keyfile from '@seed-hypermedia/client/keyfile'
import * as blobs from '@shm/shared/blobs'
import {AccountProfilePanel} from '@shm/ui/components/account-profile-panel'
import {AccountSettingsLayout} from '@shm/ui/components/account-settings-layout'
import {DelegatedKeysList} from '@shm/ui/components/delegated-keys-list'
import {AccountSettingsTabs, type AccountSettingsTab} from '@shm/ui/components/account-settings-tabs'
import {ImportKeyDialog} from '@shm/ui/components/import-key-dialog'
import {Monitor, Smartphone, Tablet} from 'lucide-react'
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
              onTabChange={(nextTab) => navigate(`/accounts/${encodeURIComponent(selected.principal)}/${nextTab}`)}
            />
            {tab === 'account' ? (
              <AccountTabContent
                principal={selected.principal}
                account={selected.account as vault.Account}
                profile={profiles[selected.principal]}
                profileLoadState={profileLoadStates[selected.principal]}
                backendHttpBaseUrl={backendHttpBaseUrl}
              />
            ) : null}
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
  size = 28,
}: {
  avatar?: string
  name: string
  backendHttpBaseUrl: string
  size?: number
}) {
  const src = avatar ? getProfileAvatarImageSrc(backendHttpBaseUrl, avatar) : ''
  const style = {width: size, height: size}
  if (src) {
    return <img src={src} alt="" style={style} className="rounded-full object-cover" />
  }
  return (
    <div style={style} className="bg-muted flex items-center justify-center rounded-full text-xs font-medium">
      {(name || '?')[0]?.toUpperCase()}
    </div>
  )
}

function AccountTabContent({
  principal,
  account,
  profile,
  profileLoadState,
  backendHttpBaseUrl,
}: {
  principal: string
  account: vault.Account
  profile?: AccountProfileSummary
  profileLoadState?: ProfileLoadState
  backendHttpBaseUrl: string
}) {
  const actions = useActions()
  const {loading, error} = useAppState()
  const [editingProfile, setEditingProfile] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const name = getProfileDisplayName(profile, profileLoadState)
  const canEditProfile = profileLoadState !== 'unavailable'

  async function handleExport(password: string) {
    const payload = await keyfile.create({
      publicKey: principal,
      key: account.seed,
      password: password.length > 0 ? password : undefined,
      profile: profile ? {name: profile.name, description: profile.description} : undefined,
    })
    const fileName = `${principal}.hmkey.json`
    const contents = keyfile.stringify(payload)
    const blob = new Blob([contents], {type: 'application/json'})
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await actions.deleteAccount(principal)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <AccountProfilePanel
        name={name}
        accountId={principal}
        avatar={
          <AccountAvatar avatar={profile?.avatar} name={name} backendHttpBaseUrl={backendHttpBaseUrl} size={56} />
        }
        onCopyId={() => void navigator.clipboard?.writeText(principal)}
        onExport={handleExport}
        onDelete={handleDelete}
        deleteBusy={deleting}
        onEditProfile={() => setEditingProfile(true)}
        editProfileLabel={profile ? 'Edit Profile' : 'Create Profile'}
        editProfileDisabled={loading || !canEditProfile}
      />
      <AccountProfileDialog
        open={editingProfile}
        onOpenChange={setEditingProfile}
        title={profile ? 'Edit Profile' : 'Create Profile'}
        descriptionText={
          profile
            ? 'Update the public profile attached to this Hypermedia identity.'
            : 'Publish a profile for this Hypermedia identity so apps can display it correctly.'
        }
        submitLabel={profile ? 'Save Profile' : 'Create Profile'}
        loading={loading}
        error={error}
        initialName={profile?.name ?? ''}
        initialDescription={profile?.description ?? ''}
        initialAvatar={profile?.avatar}
        onSubmit={async (nextProfile) => {
          const didUpdate = await actions.updateAccountProfile(principal, nextProfile)
          if (didUpdate) setEditingProfile(false)
        }}
      />
    </>
  )
}

function DevicesTabContent({account}: {account: vault.Account}) {
  const sessions = account.delegations || []
  return (
    <DelegatedKeysList
      emptyDescription="Sessions you authorize on other devices will appear here."
      items={sessions.map((session) => {
        const delegatePrincipal = blobs.principalToString(session.capability.delegate)
        const DeviceIcon =
          session.deviceType === 'mobile' ? Smartphone : session.deviceType === 'tablet' ? Tablet : Monitor
        return {
          id: `${session.clientId}:${delegatePrincipal}`,
          title: session.clientId,
          subtitle: delegatePrincipal,
          icon: <DeviceIcon className="size-5" />,
          dateLabel: new Date(session.createTime).toLocaleDateString(),
        }
      })}
    />
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
