import {useAppContext} from '@/app-context'
import {useCreateAccountDialog} from '@/components/create-account'
import {useDesktopAuthDialog} from '@/components/desktop-auth-dialog'
import {useEditProfileDialog} from '@/components/edit-profile-dialog'
import {
  useChangeVaultEmailStart,
  useChangeVaultEmailVerify,
  useDeleteKey,
  useDisconnectVault,
  useExportKey,
  useImportKey,
  useListKeys,
  useLogout,
  useMyAccountIds,
  useSetVaultMasterPassword,
  useSetVaultNotificationServer,
  useVaultEmail,
  useVaultNotificationServer,
  useVaultPasswordStatus,
  useVaultStatus,
} from '@/models/daemon'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {
  useNotificationConfig,
  useRemoveNotificationConfig,
  useResendNotificationConfigVerification,
  useSetNotificationConfig,
} from '@/models/notification-config'
import {useOpenUrl} from '@/open-url'
import {useSelectedAccountId} from '@/selected-account'
import {getImportKeyFilePathError, normalizeImportKeyFilePath} from '@/utils/onboarding-import'
import {useNavigate} from '@/utils/useNavigate'
import type {HMRole} from '@seed-hypermedia/client/hm-types'
import {useUniversalAppContext} from '@shm/shared'
import {VaultBackendMode, VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useAccount, useAccounts, useCapabilities} from '@shm/shared/models/entity'
import type {AccountSettingsTab} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {formattedDate} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {AccountSettingsHeader} from '@shm/ui/components/account-settings-header'
import {AccountSettingsLayout} from '@shm/ui/components/account-settings-layout'
import {AccountSettingsTabs} from '@shm/ui/components/account-settings-tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogPortal,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {DelegatedKeysList} from '@shm/ui/components/delegated-keys-list'
import {DeleteAccountDialog} from '@shm/ui/components/delete-account-dialog'
import {ExportKeyDialog} from '@shm/ui/components/export-key-dialog'
import {ImportKeyDialog} from '@shm/ui/components/import-key-dialog'
import {Label} from '@shm/ui/components/label'
import {NotificationEmailSettings} from '@shm/ui/components/notification-email-settings'
import {SegmentedControl} from '@shm/ui/components/segmented-control'
import {VaultSecuritySettings} from '@shm/ui/components/vault-security-settings'
import {PanelContainer} from '@shm/ui/container'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {HMIcon} from '@shm/ui/hm-icon'
import {Separator} from '@shm/ui/separator'
import {SettingsRow, SettingsSection} from '@shm/ui/settings-list'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Key, Vault} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

export default function AccountSettingsPage() {
  const route = useNavRoute()
  const accountSettingsRoute = route.key === 'account-settings' ? route : undefined
  const replace = useNavigate('replace')
  const currentAccountUid = useSelectedAccountId()
  const myAccountIds = useMyAccountIds()
  const accountIds = myAccountIds.data || []
  const accountQueries = useAccounts(accountIds)
  const createAccountDialog = useCreateAccountDialog()
  const editProfileDialog = useEditProfileDialog()
  const {pickKeyImportFile, pickKeyExportFile} = useAppContext()
  const importKey = useImportKey()
  const exportKey = useExportKey()
  const deleteKey = useDeleteKey()
  const keys = useListKeys()
  // Only a remote-connected vault has an email; gate on connection status so it
  // disappears immediately when switching to a local vault.
  const vaultStatus = useVaultStatus()
  const isRemoteConnected = vaultStatus.data?.connectionStatus === VaultConnectionStatus.CONNECTED
  const vaultEmail = useVaultEmail({enabled: isRemoteConnected})
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)

  const isVaultSelected = accountSettingsRoute?.view === 'vault'
  const selectedUid = isVaultSelected ? null : accountSettingsRoute?.accountUid ?? null
  const activeTab: AccountSettingsTab = accountSettingsRoute?.tab ?? 'devices'

  const [pendingSelectUid, setPendingSelectUid] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFilePath, setImportFilePath] = useState('')
  // Targets for the account-row options menu (export / delete) — keyed by the
  // hovered account, independent of the account open in the detail pane.
  const [exportTargetUid, setExportTargetUid] = useState<string | null>(null)
  const [deleteTargetUid, setDeleteTargetUid] = useState<string | null>(null)

  useEffect(() => {
    if (!importOpen) setImportFilePath('')
  }, [importOpen])

  // Persist a default account selection in the route (so a refresh restores it),
  // auto-selecting the current account and falling back to the first available
  // one. A freshly imported account is honored once it appears in the list.
  // Skipped while the vault view is selected.
  useEffect(() => {
    if (isVaultSelected) return
    if (pendingSelectUid) {
      if (accountIds.includes(pendingSelectUid)) setPendingSelectUid(null)
      return
    }
    if (!myAccountIds.data) return
    if (selectedUid && accountIds.includes(selectedUid)) return
    const next = currentAccountUid && accountIds.includes(currentAccountUid) ? currentAccountUid : accountIds[0]
    if (next && next !== selectedUid) {
      replace({key: 'account-settings', accountUid: next, tab: accountSettingsRoute?.tab})
    }
  }, [
    isVaultSelected,
    pendingSelectUid,
    accountIds,
    myAccountIds.data,
    selectedUid,
    currentAccountUid,
    accountSettingsRoute?.tab,
    replace,
  ])

  const accountOptions = accountIds
    .map((uid, index) => {
      const data = accountQueries[index]?.data
      return data ? {uid, data} : null
    })
    .filter((o) => !!o)

  function selectAccount(uid: string) {
    replace({key: 'account-settings', accountUid: uid, tab: accountSettingsRoute?.tab})
  }

  return (
    <PanelContainer>
      <AccountSettingsLayout
        accounts={accountOptions.map((option) => ({
          id: option.uid,
          name: option.data.metadata?.name || `?${option.uid.slice(-8)}`,
          icon: (
            <HMIcon
              id={hmId(option.uid)}
              name={option.data.metadata?.name}
              icon={option.data.metadata?.icon}
              size={28}
            />
          ),
          menu: {
            onEditProfile: () => editProfileDialog.open({accountUid: option.uid}),
            onCopyId: () => {
              copyTextToClipboard(option.uid)
              toast.success('Account ID copied to clipboard')
            },
            onExportKey: () => setExportTargetUid(option.uid),
            onDelete: () => setDeleteTargetUid(option.uid),
          },
        }))}
        selectedAccountId={selectedUid}
        isVaultSelected={isVaultSelected}
        vaultEmail={isRemoteConnected ? vaultEmail.data?.trim() || undefined : undefined}
        onSelectVault={() => replace({key: 'account-settings', view: 'vault'})}
        onSelectAccount={selectAccount}
        onAddAccount={() => createAccountDialog.open({})}
        onImportKey={() => setImportOpen(true)}
      >
        {isVaultSelected ? (
          <VaultSettings />
        ) : selectedUid ? (
          <AccountSettingsDetail accountUid={selectedUid} tab={activeTab} />
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <SizableText color="muted">No accounts yet. Add one to get started.</SizableText>
          </div>
        )}
      </AccountSettingsLayout>
      {createAccountDialog.content}
      {editProfileDialog.content}
      <ImportKeyDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        hasFile={!!importFilePath}
        renderFileField={({clearError}) => (
          <div className="flex flex-col gap-2">
            <Label>Key File</Label>
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={async () => {
                try {
                  const selectedPath = await pickKeyImportFile()
                  if (!selectedPath) return
                  setImportFilePath(selectedPath)
                  clearError()
                } catch (error) {
                  toast.error('Failed to open file picker')
                }
              }}
            >
              {importFilePath ? 'Change file' : 'Choose file'}
            </Button>
            {importFilePath ? (
              <p className="text-muted-foreground font-mono text-sm break-all">{importFilePath}</p>
            ) : null}
          </div>
        )}
        onImport={async (password) => {
          const normalizedPath = normalizeImportKeyFilePath(importFilePath)
          const validationError = getImportKeyFilePathError(normalizedPath)
          if (validationError) throw new Error(validationError)
          const imported = await importKey.mutateAsync({filePath: normalizedPath, password})
          setPendingSelectUid(imported.publicKey)
          replace({key: 'account-settings', accountUid: imported.publicKey, tab: accountSettingsRoute?.tab})
          toast.success('Account imported')
        }}
      />
      <ExportKeyDialog
        open={!!exportTargetUid}
        onOpenChange={(open) => {
          if (!open) setExportTargetUid(null)
        }}
        busy={exportKey.isPending}
        onExport={async (password) => {
          const key = keys.data?.find((k) => k.publicKey === exportTargetUid)
          if (!exportTargetUid || !key) throw new Error('Key is not available')
          const filePath = await pickKeyExportFile(`${exportTargetUid}.hmkey.json`)
          if (!filePath) return
          await exportKey.mutateAsync({
            name: key.name,
            filePath,
            password: password.length > 0 ? password : undefined,
          })
          toast.success(`Key exported to ${filePath}`)
        }}
      />
      <DeleteAccountDialog
        open={!!deleteTargetUid}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetUid(null)
        }}
        accountName={accountOptions.find((o) => o.uid === deleteTargetUid)?.data.metadata?.name || 'Account'}
        busy={deleteKey.isPending}
        onDelete={() => {
          if (!deleteTargetUid) return
          const targetUid = deleteTargetUid
          deleteKey
            .mutateAsync({accountId: targetUid})
            .then(() => {
              if (selectedIdentityValue === targetUid) setSelectedIdentity?.(null)
              toast.success('Account deleted')
              setDeleteTargetUid(null)
            })
            .catch((error) => {
              toast.error('Failed to delete account: ' + (error instanceof Error ? error.message : 'Unknown error'))
            })
        }}
      />
    </PanelContainer>
  )
}

/**
 * Vault-wide settings. Lets the user switch between a local vault (stored on
 * this device only) and a remote vault (synced to a server for multi-device
 * continuity).
 *
 * Switching to Remote opens the shared identity auth dialog, where the user can
 * keep the default vault server URL or enter a different one before signing in
 * through the browser. When the connection completes the daemon automatically
 * merges this device's local identities into the remote vault.
 *
 * Switching back to Local disconnects but keeps the local keys (non-destructive).
 * Logging out clears all local keys, returning to a local vault with zero
 * accounts. While connected, the remote vault URL is shown read-only.
 */
function VaultSettings() {
  const vaultStatus = useVaultStatus()
  const disconnectVault = useDisconnectVault()
  const logout = useLogout()
  const authDialog = useDesktopAuthDialog()
  const openUrl = useOpenUrl()
  const {setSelectedIdentity} = useUniversalAppContext()

  const data = vaultStatus.data
  const isRemoteBackend = data?.backendMode === VaultBackendMode.REMOTE
  const isConnected = data?.connectionStatus === VaultConnectionStatus.CONNECTED
  const syncStatus = data?.syncStatus
  const vaultEmail = useVaultEmail({enabled: isConnected})
  const passwordStatus = useVaultPasswordStatus({enabled: isConnected})
  const setMasterPassword = useSetVaultMasterPassword()
  const notifyServer = useVaultNotificationServer()
  const setNotifyServer = useSetVaultNotificationServer()
  const changeEmailStart = useChangeVaultEmailStart()
  const changeEmailVerify = useChangeVaultEmailVerify()
  const emailBinding = useRef('')

  const notifyDefault = NOTIFY_SERVICE_HOST || 'https://notify.seed.hyper.media'
  const notifyOverride = notifyServer.data || ''
  const remoteVaultUrl = data?.remoteVaultUrl || ''
  const passkeyManageUrl = remoteVaultUrl ? `${remoteVaultUrl.replace(/\/+$/, '')}/settings` : ''

  const [selectedMode, setSelectedMode] = useState<'local' | 'remote'>('local')
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [switchLocalOpen, setSwitchLocalOpen] = useState(false)

  // Shared notify-server config (the synced vault-state value) — always editable.
  const notifyConfig = {
    url: notifyOverride,
    defaultUrl: notifyDefault,
    onSave: async (url: string) => {
      await setNotifyServer.mutateAsync({url})
      toast.success('Notify server URL saved')
    },
  }

  useEffect(() => {
    setSelectedMode(isRemoteBackend ? 'remote' : 'local')
  }, [isRemoteBackend])

  const isPending = disconnectVault.isPending || logout.isLoading

  function openConnectDialog() {
    // Open the normal login/register workflow (same as "Sign in" / "Create my
    // identity" from the account dropdown). From there the user can sign in,
    // create an identity, or choose a different identity server URL. The daemon
    // is responsible for merging this device's local identities into the remote
    // vault as part of completing the connection (see vault.finishConnection).
    authDialog.open({
      onReady: () => {
        setSelectedMode('remote')
        toast.success('Connected to remote vault')
      },
    })
  }

  async function handleDisconnect() {
    try {
      await disconnectVault.mutateAsync()
      setSelectedMode('local')
      toast.success('Switched to local vault')
    } catch (error) {
      toast.error('Failed to switch to local vault: ' + (error instanceof Error ? error.message : String(error)))
      setSelectedMode('remote')
    }
  }

  function handleModeChange(nextMode: 'local' | 'remote') {
    if (nextMode === 'remote') {
      // Don't flip the mode optimistically — the user is still local until the
      // connection actually completes (the effect above syncs the radio then).
      if (!isConnected) openConnectDialog()
      return
    }
    // Switching to local disconnects from the remote vault but keeps the local
    // keys (non-destructive). Confirm first; logging out (separate action)
    // clears them. Don't flip the toggle until confirmed.
    if (isRemoteBackend || isConnected) {
      setSwitchLocalOpen(true)
      return
    }
    setSelectedMode('local')
  }

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => {
        setSelectedIdentity?.(null)
        setSelectedMode('local')
        toast.success('Logged out of remote vault')
      },
      onError: (error) => {
        toast.error('Failed to log out: ' + (error instanceof Error ? error.message : String(error)))
      },
    })
  }

  const remoteVaultHost = remoteVaultUrl ? new URL(remoteVaultUrl).host : null

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 p-6">
      <SizableText size="2xl" weight="bold">
        Identity Settings
      </SizableText>

      {vaultStatus.isLoading && !data ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <>
          <SettingsSection label="STORAGE">
            <SettingsRow
              icon={<Key />}
              label="Identity Key Storage Mode"
              description={
                selectedMode === 'remote'
                  ? `Synced to ${remoteVaultHost} for multi-device account syncing.`
                  : 'Your account keys are stored on this device only.'
              }
              action={
                <SegmentedControl
                  value={selectedMode}
                  onChange={handleModeChange}
                  disabled={isPending}
                  options={[
                    {value: 'local', label: 'Local'},
                    {value: 'remote', label: 'Remote'},
                  ]}
                />
              }
            />
            {isConnected ? null : selectedMode === 'remote' ? (
              <>
                <Separator />
                <SettingsRow
                  icon={<Vault />}
                  label="Not connected"
                  description="Sign in to sync your identities across devices."
                  action={
                    <Button variant="secondary" size="sm" onClick={openConnectDialog}>
                      Connect
                    </Button>
                  }
                />
              </>
            ) : null}
          </SettingsSection>

          {isConnected ? (
            <VaultSecuritySettings
              email={{
                address: vaultEmail.data,
                onStart: async (newEmail) => {
                  const result = await changeEmailStart.mutateAsync({newEmail})
                  emailBinding.current = result.binding
                  return {expireTimeMs: result.expireTimeMs}
                },
                onVerify: async (code) => {
                  const updated = await changeEmailVerify.mutateAsync({code, binding: emailBinding.current})
                  toast.success(`Email changed to ${updated}`)
                },
              }}
              logout={{
                description: 'Disconnect from the identity server, and remove all local keys from this device.',
                onLogOut: () => setLogoutOpen(true),
                busy: isPending,
              }}
              passkey={{
                description: 'Passkeys are managed in your browser.',
                actionLabel: 'Manage Passkeys',
                onAction: () => passkeyManageUrl && openUrl(passkeyManageUrl),
              }}
              password={{
                isSet: !!passwordStatus.data,
                onSet: async (password) => {
                  await setMasterPassword.mutateAsync({password})
                  toast.success(passwordStatus.data ? 'Master password changed' : 'Master password set')
                },
              }}
              notify={notifyConfig}
              disabled={isPending}
            />
          ) : (
            <VaultSecuritySettings notify={notifyConfig} disabled={isPending} />
          )}

          {isConnected && (syncStatus?.lastSyncTime || syncStatus?.lastSyncError) ? (
            <div className="mt-auto flex justify-end pt-2">
              <SizableText size="xs" color={syncStatus?.lastSyncError ? 'destructive' : 'muted'}>
                {syncStatus?.lastSyncError
                  ? `Sync error: ${syncStatus.lastSyncError}`
                  : `Last synced ${formattedDate(syncStatus.lastSyncTime)}`}
              </SizableText>
            </div>
          ) : null}
        </>
      )}

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogPortal>
          <AlertDialogContent className="max-w-[600px] gap-4">
            <AlertDialogTitle className="text-2xl font-bold">Log out of remote vault?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect the remote vault, and will delete all keys from this desktop device.
            </AlertDialogDescription>
            <AlertDialogDescription>
              You will be able to log in with your passkey to use your accounts again.
            </AlertDialogDescription>
            <div className="flex justify-end gap-3">
              <AlertDialogCancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="destructive" onClick={handleLogout} disabled={logout.isLoading}>
                  {logout.isLoading ? 'Logging out…' : 'Log out'}
                </Button>
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>

      <AlertDialog open={switchLocalOpen} onOpenChange={setSwitchLocalOpen}>
        <AlertDialogPortal>
          <AlertDialogContent className="max-w-[600px] gap-4">
            <AlertDialogTitle className="text-2xl font-bold">Switch to local identity?</AlertDialogTitle>
            <AlertDialogDescription>
              This disconnects from the remote vault and stops syncing across your devices. Your account keys stay on
              this device — you can switch back to Remote anytime to resume syncing.
            </AlertDialogDescription>
            <div className="flex justify-end gap-3">
              <AlertDialogCancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button onClick={() => void handleDisconnect()} disabled={disconnectVault.isPending}>
                  Switch to Local
                </Button>
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
      {authDialog.content}
    </div>
  )
}

function AccountSettingsDetail({accountUid, tab}: {accountUid: string; tab: AccountSettingsTab}) {
  const replace = useNavigate('replace')
  const navigate = useNavigate()
  const account = useAccount(accountUid)
  const name = account.data?.metadata?.name || 'Account'
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <AccountSettingsHeader
        name={name}
        icon={<HMIcon id={hmId(accountUid)} name={name} icon={account.data?.metadata?.icon} size={40} />}
        onOpenProfile={() => navigate({key: 'profile', id: hmId(accountUid)})}
      />
      <AccountSettingsTabs
        activeTab={tab}
        onTabChange={(nextTab) => replace({key: 'account-settings', accountUid, tab: nextTab})}
      />
      {tab === 'notifications' ? <NotificationsTab accountUid={accountUid} /> : null}
      {tab === 'devices' ? <DevicesTab accountUid={accountUid} /> : null}
    </div>
  )
}

/**
 * Per-account email notification settings, ported from the web vault's
 * AccountNotificationsSection. Reuses the desktop notification-config hooks
 * (which sign requests via the daemon and talk to the configured notify
 * service host) so an account can register an email to receive notifications.
 */
function NotificationsTab({accountUid}: {accountUid: string}) {
  // `useNotifyServiceHost()` is `undefined` until the vault notification server
  // (and gateway setting) have loaded. Do NOT fall back to a hardcoded host: an
  // earlier `|| 'https://notify.seed.hyper.media'` made every refresh send the
  // production URL during the loading window, which poisoned the per-account
  // host hint and triggered a sync against the wrong server that wiped the
  // locally-stored (correct) config. Instead, gate the queries until the real
  // host is known.
  const notifyServiceHost = useNotifyServiceHost()
  const hostResolved = Boolean(notifyServiceHost)
  const {data: config, isLoading} = useNotificationConfig(notifyServiceHost, accountUid, {enabled: hostResolved})
  const setConfig = useSetNotificationConfig(notifyServiceHost, accountUid)
  const removeConfig = useRemoveNotificationConfig(notifyServiceHost, accountUid)
  const resendVerification = useResendNotificationConfigVerification(notifyServiceHost, accountUid)

  const currentEmail = config?.email ?? null
  const isVerified = Boolean(config?.verifiedTime)
  const verificationSendTime = config?.verificationSendTime ?? null
  const verificationExpired = Boolean(config?.verificationExpired)
  const isNotifyServerConnected = config?.isNotifyServerConnected !== false
  const needsVerification = Boolean(currentEmail && !isVerified)
  const canResendVerification = needsVerification && (verificationExpired || !verificationSendTime)

  const verificationMessage =
    verificationSendTime && !verificationExpired
      ? 'Email verification is pending. Click the link in your inbox to activate notification emails.'
      : verificationExpired
        ? 'Your verification link expired. Request a new verification email.'
        : 'Notification emails are paused until you verify this email address.'

  return (
    <NotificationEmailSettings
      serverLabel={notifyServiceHost ? notifyServiceHost.replace(/^https?:\/\//, '').replace(/\/$/, '') : null}
      isRegistered
      isNotifyServerConnected={isNotifyServerConnected}
      loading={!hostResolved || (isLoading && !config)}
      email={currentEmail}
      isVerified={isVerified}
      needsVerification={needsVerification}
      verificationMessage={verificationMessage}
      error={config?.syncError ?? null}
      saving={setConfig.isLoading}
      removing={removeConfig.isLoading}
      resending={resendVerification.isLoading}
      onSetEmail={(email) =>
        setConfig.mutate(
          {email},
          {
            onSuccess: (result: any) => {
              if (result?.verifiedTime) {
                toast.success('Email updated')
              } else {
                toast.success('Verification email sent. Click the link in your inbox to activate notifications.')
              }
            },
          },
        )
      }
      onRemoveEmail={() =>
        removeConfig.mutate(undefined, {onSuccess: () => toast.success('Notification email removed')})
      }
      onResendVerification={
        canResendVerification
          ? () =>
              resendVerification.mutate(undefined, {
                onSuccess: () => toast.success('Verification email sent. Check your inbox.'),
              })
          : undefined
      }
    />
  )
}

const DELEGATED_ROLE_LABELS: Partial<Record<HMRole, string>> = {
  agent: 'Agent / session key',
  writer: 'Writer',
}

/**
 * Lists the account's delegated keys ("devices") — capabilities the account has
 * issued to other keys, such as web-session keys (AGENT role) and collaborator
 * keys (WRITER role). Sourced from the daemon's ListCapabilities for the
 * account's home document; the synthetic owner entry and revoked (`none`) grants
 * are filtered out.
 */
function DevicesTab({accountUid}: {accountUid: string}) {
  const capabilities = useCapabilities(hmId(accountUid))
  const delegatedKeys = (capabilities.data || []).filter(
    (cap) => cap.id !== '_owner' && cap.role !== 'owner' && cap.role !== 'none',
  )

  if (capabilities.isLoading && !capabilities.data) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <DelegatedKeysList
      items={delegatedKeys.map((cap) => ({
        id: cap.id || cap.accountUid,
        title: cap.label || DELEGATED_ROLE_LABELS[cap.role] || 'Delegated key',
        subtitle: cap.accountUid,
        badge: cap.role,
        dateLabel: cap.createTime ? formattedDate(cap.createTime) : undefined,
      }))}
    />
  )
}
