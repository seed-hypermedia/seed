import {Alert, AlertDescription} from '@/frontend/components/ui/alert'
import {useActions, useAppState} from '@/frontend/store'
import {VaultSecuritySettings} from '@shm/ui/components/vault-security-settings'

/**
 * Vault-level settings view for managing authentication credentials and account settings.
 * These settings apply to the entire vault, not individual Hypermedia accounts.
 */
export function SettingsView() {
  const {session, loading, passkeySupported, notificationServerUrl, vaultData} = useAppState()
  const actions = useActions()
  const notifyOverride = vaultData?.notificationServerUrl?.trim() || ''
  const hasPassword = !!session?.credentials?.password
  const hasPasskey = !!session?.credentials?.passkey

  return (
    <div className="w-full space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-muted-foreground text-sm">Manage authentication and security for your vault</p>
      </div>

      <VaultSecuritySettings
        passkey={{
          description: hasPasskey ? 'One or more passkeys registered' : 'No passkeys registered',
          actionLabel: passkeySupported ? 'Add Passkey' : undefined,
          onAction: actions.handleRegisterPasskey,
          busy: loading,
        }}
        password={{
          isSet: hasPassword,
          onSet: (password) => actions.setMasterPasswordDialog(password),
        }}
        notify={{
          url: notifyOverride,
          defaultUrl: notificationServerUrl,
          onSave: async (url) => {
            const ok = await actions.saveNotificationServerUrl(url)
            if (!ok) throw new Error('Failed to save notification server URL')
          },
        }}
        email={{
          address: session?.email,
          onStart: (newEmail) => actions.changeEmailDialogStart(newEmail),
          onVerify: (code) => actions.changeEmailDialogVerify(code),
        }}
        disabled={loading}
      />

      {!passkeySupported && !hasPassword ? (
        <Alert variant="info">
          <AlertDescription>Add at least one authentication method to protect your vault.</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
