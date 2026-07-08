import {Alert, AlertDescription} from '@/frontend/components/ui/alert'
import {useActions, useAppState} from '@/frontend/store'
import {VaultSecuritySettings} from '@shm/ui/components/vault-security-settings'
import {SizableText} from '@shm/ui/text'

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
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 p-6">
      <SizableText size="2xl" weight="bold">
        Identity Settings
      </SizableText>

      <VaultSecuritySettings
        email={{
          address: session?.email,
          onStart: (newEmail) => actions.changeEmailDialogStart(newEmail),
          onVerify: (code) => actions.changeEmailDialogVerify(code),
        }}
        logout={{
          description: 'Sign out of this vault on this device.',
          onLogOut: () => actions.handleLogout(),
        }}
        passkey={{
          description: hasPasskey ? 'One or more passkeys registered' : 'No passkeys registered',
          actionLabel: passkeySupported ? 'Add Passkey' : undefined,
          onAction: actions.handleRegisterPasskey,
          busy: loading,
        }}
        password={{
          isSet: hasPassword,
          onSet: (password) => actions.setPasswordFromDialog(password),
        }}
        notify={{
          url: notifyOverride,
          defaultUrl: notificationServerUrl,
          onSave: async (url) => {
            const ok = await actions.saveNotificationServerUrl(url)
            if (!ok) throw new Error('Failed to save notification server URL')
          },
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
