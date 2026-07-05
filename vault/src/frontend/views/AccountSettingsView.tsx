import {AccountNotificationsSection} from '@/frontend/components/AccountNotificationsSection'
import {AccountProfileDialog} from '@/frontend/components/AccountProfileDialog'
import {CreateAccountDialog} from '@/frontend/components/CreateAccountDialog'
import {Button} from '@/frontend/components/ui/button'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {type AccountProfileSummary, getProfileAvatarImageSrc, getProfileDisplayName} from '@/frontend/profile'
import {useActions, useAppState} from '@/frontend/store'
import * as vault from '@/frontend/vault'
import * as keyfile from '@seed-hypermedia/client/keyfile'
import * as blobs from '@shm/shared/blobs'
import {UIAvatar} from '@shm/ui/avatar'
import {AccountSettingsHeader} from '@shm/ui/components/account-settings-header'
import {AccountSettingsLayout} from '@shm/ui/components/account-settings-layout'
import {DelegatedKeysList} from '@shm/ui/components/delegated-keys-list'
import {AccountSettingsTabs, type AccountSettingsTab} from '@shm/ui/components/account-settings-tabs'
import {DeleteAccountDialog} from '@shm/ui/components/delete-account-dialog'
import {ExportKeyDialog} from '@shm/ui/components/export-key-dialog'
import {ImportKeyDialog} from '@shm/ui/components/import-key-dialog'
import {Monitor, Smartphone, Tablet} from 'lucide-react'
import {useEffect, useState, type ReactNode} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'
import {SettingsView} from './SettingsView'

const ACCOUNT_TABS: AccountSettingsTab[] = ['devices', 'notifications']
const DEFAULT_ACCOUNT_TAB: AccountSettingsTab = 'devices'

/**
 * Parses the account selection out of the URL hash (`#/a/<principal>` or
 * `#/a/<principal>/<tab>`). The selection lives in the hash so the server never
 * sees it — the fragment is never sent on requests, and a reload only needs the
 * `/vault` path to resolve.
 */
function parseAccountHash(hash: string): {accountId: string; tab: AccountSettingsTab} | null {
  const segments = hash.replace(/^#/, '').split('/').filter(Boolean)
  if (segments[0] !== 'a' || !segments[1]) return null
  try {
    const accountId = decodeURIComponent(segments[1])
    const tab = ACCOUNT_TABS.includes(segments[2] as AccountSettingsTab)
      ? (segments[2] as AccountSettingsTab)
      : DEFAULT_ACCOUNT_TAB
    return {accountId, tab}
  } catch {
    return null
  }
}

/** Builds the `#/a/<principal>[/<tab>]` hash for an account selection. */
function formatAccountHash(accountId: string, tab: AccountSettingsTab = DEFAULT_ACCOUNT_TAB): string {
  const base = `#/a/${encodeURIComponent(accountId)}`
  return tab === DEFAULT_ACCOUNT_TAB ? base : `${base}/${tab}`
}

/** Builds an encrypted/plaintext `.hmkey.json` for an account and downloads it. */
async function downloadAccountKeyfile(
  principal: string,
  seed: Uint8Array,
  profile: AccountProfileSummary | undefined,
  password: string,
) {
  const payload = await keyfile.create({
    publicKey: principal,
    key: seed,
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

/**
 * The unlocked web vault UI: a shared account-settings layout (account sidebar +
 * per-account tabs + Identity Settings), backed by the vault store. Account/tab
 * selection lives in the URL hash (`/vault#/a/<principal>/<tab>`) so it stays
 * client-side; Identity Settings is the one server-visible path (`/settings`),
 * which the desktop app deep-links to for passkey management.
 */
export function AccountSettingsView() {
  const navigate = useNavigate()
  const location = useLocation()
  const actions = useActions()
  const {
    vaultData,
    profiles,
    profileLoadStates,
    backendHttpBaseUrl,
    webBaseUrl,
    session,
    notificationServerUrl,
    loading,
    error,
  } = useAppState()

  const accounts = vaultData?.accounts ?? []
  const accountList = accounts.map((account, index) => {
    const kp = blobs.nobleKeyPairFromSeed(account.seed)
    const principal = blobs.principalToString(kp.principal)
    return {principal, account, index}
  })
  const accountsKey = accountList.map((a) => a.principal).join(',')

  const isVaultSelected = location.pathname === '/settings'
  const route = parseAccountHash(location.hash)
  const selectedAccountId = route?.accountId ?? null
  const tab = route?.tab ?? DEFAULT_ACCOUNT_TAB
  const selected = accountList.find((a) => a.principal === selectedAccountId) ?? null

  const [importOpen, setImportOpen] = useState(false)
  // Targets for the account-row options menu (export / delete) — keyed by the
  // hovered account, independent of which account is selected in the detail pane.
  const [exportTarget, setExportTarget] = useState<{
    principal: string
    seed: Uint8Array
    profile?: AccountProfileSummary
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{principal: string; name: string} | null>(null)
  const [deletingTarget, setDeletingTarget] = useState(false)
  const [editTargetPrincipal, setEditTargetPrincipal] = useState<string | null>(null)

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

  // When not viewing Vault Settings and no valid account is selected in the hash,
  // land on the first account (or Vault Settings if there are no accounts).
  //
  // Guard on `vaultLoaded`: during unlock the view mounts before the vault data
  // arrives (decryptedDEK is set just before loadVaultData resolves). Redirecting
  // in that gap would clobber the restored `#/a/<principal>/<tab>` hash before the
  // accounts exist to match it. Once loaded, a hash pointing at a real account
  // resolves to `selected` and no redirect happens.
  const vaultLoaded = !!vaultData
  useEffect(() => {
    if (isVaultSelected || selected || !vaultLoaded) return
    const first = accountList[0]
    if (first) {
      navigate({pathname: '/', hash: formatAccountHash(first.principal)}, {replace: true})
    } else {
      navigate('/settings', {replace: true})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVaultSelected, selected?.principal, vaultLoaded, accountsKey])

  const sidebarAccounts = accountList.map((a) => {
    const profile = profiles[a.principal]
    const name = getProfileDisplayName(profile, profileLoadStates[a.principal])
    return {
      id: a.principal,
      name,
      icon: (
        <AccountAvatar
          principal={a.principal}
          avatar={profile?.avatar}
          name={name}
          backendHttpBaseUrl={backendHttpBaseUrl}
        />
      ),
      menu: {
        onEditProfile: () => setEditTargetPrincipal(a.principal),
        onCopyId: () => void navigator.clipboard?.writeText(a.principal),
        onExportKey: () => setExportTarget({principal: a.principal, seed: a.account.seed, profile}),
        onDelete: () => setDeleteTarget({principal: a.principal, name}),
      },
    }
  })

  const effectiveNotifyUrl = vaultData?.notificationServerUrl?.trim() || notificationServerUrl
  const sessionEmail = session?.email?.trim() || ''

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="bg-card flex h-[640px] w-full overflow-hidden rounded-xl border max-md:h-auto max-md:min-h-[480px] max-md:flex-col">
        <AccountSettingsLayout
          accounts={sidebarAccounts}
          selectedAccountId={selectedAccountId}
          isVaultSelected={isVaultSelected}
          vaultEmail={sessionEmail || undefined}
          onSelectVault={() => navigate('/settings')}
          onSelectAccount={(id) => navigate({pathname: '/', hash: formatAccountHash(id)})}
          onAddAccount={() => actions.setCreatingAccount(true)}
          onImportKey={() => setImportOpen(true)}
        >
          {isVaultSelected ? (
            <SettingsView />
          ) : selected ? (
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
              <AccountSettingsHeader
                name={getProfileDisplayName(profiles[selected.principal], profileLoadStates[selected.principal])}
                icon={
                  <AccountAvatar
                    principal={selected.principal}
                    avatar={profiles[selected.principal]?.avatar}
                    name={getProfileDisplayName(profiles[selected.principal], profileLoadStates[selected.principal])}
                    backendHttpBaseUrl={backendHttpBaseUrl}
                    size={40}
                  />
                }
                onOpenProfile={() => {
                  // Public hypermedia profile URL on the web reader host. Prefer the
                  // configured web base URL (SEED_VAULT_WEB_BASE_URL); otherwise fall
                  // back to the current origin (vault + reader share a host in prod).
                  const host = (webBaseUrl?.trim() || window.location.origin).replace(/\/$/, '')
                  window.open(`${host}/hm/${selected.principal}`, '_blank', 'noopener,noreferrer')
                }}
              />
              <AccountSettingsTabs
                activeTab={tab}
                onTabChange={(nextTab) =>
                  navigate({pathname: '/', hash: formatAccountHash(selected.principal, nextTab)})
                }
              />
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
            <div className="text-muted-foreground flex h-full items-center justify-center p-8">
              No account selected.
            </div>
          )}
        </AccountSettingsLayout>

        <CreateAccountDialog />
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      </div>

      <ExportKeyDialog
        open={!!exportTarget}
        onOpenChange={(open) => {
          if (!open) setExportTarget(null)
        }}
        onExport={async (password) => {
          if (!exportTarget) return
          await downloadAccountKeyfile(exportTarget.principal, exportTarget.seed, exportTarget.profile, password)
        }}
      />
      <DeleteAccountDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        accountName={deleteTarget?.name ?? ''}
        busy={deletingTarget}
        onDelete={async () => {
          if (!deleteTarget) return
          setDeletingTarget(true)
          try {
            await actions.deleteAccount(deleteTarget.principal)
          } finally {
            setDeletingTarget(false)
            setDeleteTarget(null)
          }
        }}
      />
      {(() => {
        const editProfile = editTargetPrincipal ? profiles[editTargetPrincipal] : undefined
        return (
          <AccountProfileDialog
            open={!!editTargetPrincipal}
            onOpenChange={(open) => {
              if (!open) setEditTargetPrincipal(null)
            }}
            title={editProfile ? 'Edit Profile' : 'Create Profile'}
            descriptionText={
              editProfile
                ? 'Update the public profile attached to this Hypermedia identity.'
                : 'Publish a profile for this Hypermedia identity so apps can display it correctly.'
            }
            submitLabel={editProfile ? 'Save Profile' : 'Create Profile'}
            loading={loading}
            error={error}
            initialName={editProfile?.name ?? ''}
            initialDescription={editProfile?.description ?? ''}
            initialAvatar={editProfile?.avatar}
            onSubmit={async (nextProfile) => {
              if (!editTargetPrincipal) return
              const didUpdate = await actions.updateAccountProfile(editTargetPrincipal, nextProfile)
              if (didUpdate) setEditTargetPrincipal(null)
            }}
          />
        )
      })()}
    </div>
  )
}

function AccountAvatar({
  principal,
  avatar,
  name,
  backendHttpBaseUrl,
  size = 28,
}: {
  principal: string
  avatar?: string
  name: string
  backendHttpBaseUrl: string
  size?: number
}) {
  const url = avatar ? getProfileAvatarImageSrc(backendHttpBaseUrl, avatar) : undefined
  // Match desktop/web-app: the jdenticon fallback is keyed on the hypermedia id
  // (`hm://<principal>`), so the generated avatar is identical across platforms.
  return <UIAvatar id={`hm://${principal}`} label={name} url={url || undefined} size={size} className="rounded-full" />
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
