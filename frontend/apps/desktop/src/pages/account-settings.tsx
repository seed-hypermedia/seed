import {useAppContext} from '@/app-context'
import {useCreateAccountDialog} from '@/components/create-account'
import {useEditProfileDialog} from '@/components/edit-profile-dialog'
import {useDeleteKey, useExportKey, useImportKey, useListKeys, useMyAccountIds} from '@/models/daemon'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {
  useNotificationConfig,
  useRemoveNotificationConfig,
  useResendNotificationConfigVerification,
  useSetNotificationConfig,
} from '@/models/notification-config'
import {useSelectedAccountId} from '@/selected-account'
import {getImportKeyFilePathError, normalizeImportKeyFilePath} from '@/utils/onboarding-import'
import {useNavigate} from '@/utils/useNavigate'
import type {HMRole} from '@seed-hypermedia/client/hm-types'
import {useUniversalAppContext} from '@shm/shared'
import {useAccount, useAccounts, useCapabilities} from '@shm/shared/models/entity'
import type {AccountSettingsTab} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {formattedDate} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
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
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {ImportKeyDialog} from '@shm/ui/components/import-key-dialog'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {PanelContainer} from '@shm/ui/container'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {HMIcon} from '@shm/ui/hm-icon'
import {Copy, ExternalLink, Pencil, User} from '@shm/ui/icons'
import {PageTabs, type PageTabItem} from '@shm/ui/page-tabs'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {Bell, Import, KeyRound, MonitorSmartphone, Plus, Trash} from 'lucide-react'
import React, {useEffect, useState} from 'react'

export default function AccountSettingsPage() {
  const route = useNavRoute()
  const accountSettingsRoute = route.key === 'account-settings' ? route : undefined
  const replace = useNavigate('replace')
  const currentAccountUid = useSelectedAccountId()
  const myAccountIds = useMyAccountIds()
  const accountIds = myAccountIds.data || []
  const accountQueries = useAccounts(accountIds)
  const createAccountDialog = useCreateAccountDialog()
  const {pickKeyImportFile} = useAppContext()
  const importKey = useImportKey()

  const selectedUid = accountSettingsRoute?.accountUid ?? null
  const activeTab: AccountSettingsTab = accountSettingsRoute?.tab ?? 'account'

  const [pendingSelectUid, setPendingSelectUid] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFilePath, setImportFilePath] = useState('')

  useEffect(() => {
    if (!importOpen) setImportFilePath('')
  }, [importOpen])

  // Persist a default account selection in the route (so a refresh restores it),
  // auto-selecting the current account and falling back to the first available
  // one. A freshly imported account is honored once it appears in the list.
  useEffect(() => {
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
      <div className="flex h-full min-h-0 w-full">
        {/* Accounts sidebar */}
        <div className="bg-sidebar flex w-[260px] shrink-0 flex-col border-r border-black/10 dark:border-white/10">
          <div className="px-4 py-3">
            <SizableText size="sm" weight="bold" color="muted">
              Accounts
            </SizableText>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {accountOptions.map((option) => {
              const isSelected = option.uid === selectedUid
              const name = option.data.metadata?.name || `?${option.uid.slice(-8)}`
              return (
                <button
                  key={option.uid}
                  onClick={() => selectAccount(option.uid)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left',
                    isSelected
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'hover:bg-black/5 dark:hover:bg-white/5',
                  )}
                >
                  <HMIcon
                    id={hmId(option.uid)}
                    name={option.data.metadata?.name}
                    icon={option.data.metadata?.icon}
                    size={28}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-col gap-1 border-t border-black/10 p-2 dark:border-white/10">
            <button
              onClick={() => createAccountDialog.open({})}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5"
            >
              <div className="bg-muted flex size-7 items-center justify-center rounded-full">
                <Plus className="size-4" />
              </div>
              <span className="text-sm font-medium">Add account</span>
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5"
            >
              <div className="bg-muted flex size-7 items-center justify-center rounded-full">
                <Import className="size-4" />
              </div>
              <span className="text-sm font-medium">Import key</span>
            </button>
          </div>
        </div>

        {/* Selected account settings */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selectedUid ? (
            <AccountSettingsDetail accountUid={selectedUid} tab={activeTab} />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <SizableText color="muted">No accounts yet. Add one to get started.</SizableText>
            </div>
          )}
        </div>
      </div>
      {createAccountDialog.content}
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
    </PanelContainer>
  )
}

function AccountSettingsDetail({accountUid, tab}: {accountUid: string; tab: AccountSettingsTab}) {
  const tabs: PageTabItem[] = [
    {key: 'account', label: 'Account', icon: User, route: {key: 'account-settings', accountUid, tab: 'account'}},
    {
      key: 'notifications',
      label: 'Notifications',
      icon: Bell,
      route: {key: 'account-settings', accountUid, tab: 'notifications'},
    },
    {
      key: 'devices',
      label: 'Devices',
      icon: MonitorSmartphone,
      route: {key: 'account-settings', accountUid, tab: 'devices'},
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <SizableText size="2xl" weight="bold">
        Account Settings
      </SizableText>
      <PageTabs tabs={tabs} activeTab={tab} />
      {tab === 'account' ? <AccountTab accountUid={accountUid} /> : null}
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
  const notifyServiceHost = useNotifyServiceHost() || 'https://notify.seed.hyper.media'
  const {data: config, isLoading} = useNotificationConfig(notifyServiceHost, accountUid)
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

  const [emailInput, setEmailInput] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  if (isLoading && !config) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div>
        <SizableText weight="bold">Email notifications</SizableText>
        <SizableText size="sm" color="muted">
          Receive an email when there is activity involving this account.
        </SizableText>
      </div>

      {!isNotifyServerConnected ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          You are not connected to the notification server.
        </div>
      ) : null}

      {needsVerification ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p>
            {verificationSendTime && !verificationExpired
              ? 'Email verification is pending. Click the link in your inbox to activate notification emails.'
              : verificationExpired
                ? 'Your verification link expired. Request a new verification email.'
                : 'Notification emails are paused until you verify this email address.'}
          </p>
          {canResendVerification ? (
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resendVerification.isLoading}
                onClick={() => {
                  resendVerification.mutate(undefined, {
                    onSuccess: () => toast.success('Verification email sent. Check your inbox.'),
                  })
                }}
              >
                {resendVerification.isLoading ? 'Sending…' : 'Resend verification email'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isNotifyServerConnected ? (
        currentEmail && !isEditing ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <SizableText size="sm" weight="bold" className="truncate">
                {currentEmail}
              </SizableText>
              {isVerified ? (
                <SizableText size="xs" color="muted">
                  Verified
                </SizableText>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEmailInput(currentEmail)
                  setIsEditing(true)
                }}
              >
                Edit Email
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={removeConfig.isLoading}
                onClick={() => {
                  removeConfig.mutate(undefined, {
                    onSuccess: () => {
                      setEmailInput('')
                      setIsEditing(false)
                      toast.success('Notification email removed')
                    },
                  })
                }}
              >
                {removeConfig.isLoading ? 'Removing…' : 'Remove Email'}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!emailInput) return
              setConfig.mutate(
                {email: emailInput},
                {
                  onSuccess: (result: any) => {
                    setIsEditing(false)
                    if (result?.verifiedTime) {
                      toast.success('Email updated')
                    } else {
                      toast.success('Verification email sent. Click the link in your inbox to activate notifications.')
                    }
                  },
                },
              )
            }}
          >
            <Input
              type="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              {currentEmail ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEmailInput(currentEmail)
                    setIsEditing(false)
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" disabled={!emailInput || setConfig.isLoading}>
                {setConfig.isLoading ? 'Saving…' : currentEmail ? 'Save Email' : 'Set Email'}
              </Button>
            </div>
          </form>
        )
      ) : null}
    </div>
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

  if (!delegatedKeys.length) {
    return (
      <AccountSettingsStub
        label="No delegated keys"
        description="Keys this account delegates to other devices and web sessions will appear here."
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {delegatedKeys.map((cap) => {
        const title = cap.label || DELEGATED_ROLE_LABELS[cap.role] || 'Delegated key'
        return (
          <div
            key={cap.id || cap.accountUid}
            className="flex items-center gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10"
          >
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
              <KeyRound className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <SizableText size="sm" weight="bold" className="truncate">
                {title}
              </SizableText>
              <SizableText size="xs" color="muted" className="truncate font-mono">
                {cap.accountUid}
              </SizableText>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs capitalize">
                {cap.role}
              </span>
              {cap.createTime ? (
                <SizableText size="xs" color="muted">
                  {formattedDate(cap.createTime)}
                </SizableText>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AccountSettingsStub({label, description}: {label: string; description: string}) {
  return (
    <div className="border-border flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center">
      <SizableText weight="bold">{label}</SizableText>
      <SizableText size="sm" color="muted" className="max-w-sm">
        {description} Coming soon.
      </SizableText>
    </div>
  )
}

function AccountTab({accountUid}: {accountUid: string}) {
  const account = useAccount(accountUid)
  const navigate = useNavigate()
  const editProfileDialog = useEditProfileDialog()
  const {pickKeyExportFile} = useAppContext()
  const exportKey = useExportKey()
  const deleteKey = useDeleteKey()
  const keys = useListKeys()
  const selectedKey = keys.data?.find((key) => key.publicKey === accountUid)
  const name = account.data?.metadata?.name || 'Account'

  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)

  function handleDeleteAccount() {
    deleteKey
      .mutateAsync({accountId: accountUid})
      .then(() => {
        if (selectedIdentityValue === accountUid) setSelectedIdentity?.(null)
        toast.success('Account deleted')
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Unknown error'
        toast.error('Failed to delete account: ' + message)
      })
  }

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExportKey(e?: React.FormEvent) {
    e?.preventDefault()
    if (!selectedKey) return
    setExportError(null)
    try {
      const filePath = await pickKeyExportFile(`${accountUid}.hmkey.json`)
      if (!filePath) return
      await exportKey.mutateAsync({
        name: selectedKey.name,
        filePath,
        password: exportPassword.length > 0 ? exportPassword : undefined,
      })
      setIsExportDialogOpen(false)
      setExportPassword('')
      toast.success(`Key exported to ${filePath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown export error'
      setExportError(message)
      toast.error('Failed to export key: ' + message)
    }
  }

  return (
    <>
      {/* Account identity card */}
      <div className="flex items-center gap-4 rounded-xl border border-black/10 p-4 dark:border-white/10">
        <HMIcon id={hmId(accountUid)} name={name} icon={account.data?.metadata?.icon} size={64} />
        <div className="min-w-0 flex-1">
          <SizableText size="lg" weight="bold" className="truncate">
            {name}
          </SizableText>
          <SizableText size="sm" color="muted" className="truncate">
            {accountUid}
          </SizableText>
        </div>
        <Button variant="outline" onClick={() => editProfileDialog.open({accountUid})}>
          <Pencil className="size-4" />
          Edit Profile
        </Button>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="justify-start"
          onClick={() => navigate({key: 'profile', id: hmId(accountUid)})}
        >
          <User className="size-4" />
          View public profile
          <ExternalLink className="ml-auto size-4" />
        </Button>
        <Button
          variant="outline"
          className="justify-start"
          onClick={() => {
            copyTextToClipboard(accountUid)
            toast.success('Account ID copied to clipboard')
          }}
        >
          <Copy className="size-4" />
          Copy account ID
        </Button>
        <Button
          variant="outline"
          className="justify-start"
          onClick={() => {
            setExportPassword('')
            setExportError(null)
            setIsExportDialogOpen(true)
          }}
          disabled={!selectedKey}
        >
          <KeyRound className="size-4" />
          Export key
        </Button>
      </div>

      {/* Danger zone */}
      <div className="border-destructive/30 mt-2 flex flex-col gap-3 rounded-xl border p-4">
        <div>
          <SizableText weight="bold" color="destructive">
            Delete account
          </SizableText>
          <SizableText size="sm" color="muted">
            Permanently remove this account's key from your cloud vault and all your devices.
          </SizableText>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="self-start">
              <Trash className="size-4" />
              Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogPortal>
            <AlertDialogContent className="max-w-[600px] gap-4">
              <AlertDialogTitle className="text-2xl font-bold">Delete account</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the key for <span className="font-medium">{name}</span> from your cloud
                vault, and it will be removed from all devices where you are signed in. Make sure you have saved this
                account's Secret Recovery Phrase if you want to recover it later — this cannot be undone.
              </AlertDialogDescription>
              <div className="flex justify-end gap-3">
                <AlertDialogCancel asChild>
                  <Button variant="ghost">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleteKey.isPending}>
                    {deleteKey.isPending ? 'Deleting…' : 'Delete Permanently'}
                  </Button>
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialogPortal>
        </AlertDialog>
      </div>

      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Export Key File</DialogTitle>
            <DialogDescription>
              Choose whether to protect the exported `.hmkey.json` file with a password.
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={handleExportKey}>
            <div className="text-muted-foreground rounded-lg border p-3 text-sm">
              Exported key files can grant full account control. Use a password whenever possible and store the file
              securely.
            </div>
            {exportError ? <p className="text-destructive text-sm">{exportError}</p> : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="export-key-password">Password (optional)</Label>
              <Input
                id="export-key-password"
                type="password"
                value={exportPassword}
                onChange={(event) => setExportPassword(event.currentTarget.value)}
                autoComplete="off"
                placeholder="Only needed for encrypted exports"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setIsExportDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={exportKey.isPending}>
                {exportKey.isPending ? 'Exporting…' : 'Export Key'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {editProfileDialog.content}
    </>
  )
}
