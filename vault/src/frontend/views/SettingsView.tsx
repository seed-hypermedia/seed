import { Alert, AlertDescription } from '@/frontend/components/ui/alert'
import * as navigation from '@/frontend/navigation'
import { useActions, useAppState } from '@/frontend/store'
import { Button } from '@shm/ui/button'
import { Separator } from '@shm/ui/separator'
import { SettingsRow, SettingsSection } from '@shm/ui/settings-list'
import * as icons from 'lucide-react'

/**
 * Vault-level settings view for managing authentication credentials and account settings.
 * These settings apply to the entire vault, not individual Hypermedia accounts.
 */
export function SettingsView() {
  const { session, loading, passkeySupported, notificationServerUrl, vaultData } = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const effectiveNotificationServerUrl = vaultData?.notificationServerUrl?.trim() || notificationServerUrl

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">Manage authentication and security for your vault</p>
      </div>

      {/* Authentication Methods */}
      <SettingsSection label="AUTHENTICATION">
        <SettingsRow
          icon={<icons.Key />}
          label="Passkeys"
          description={session?.credentials?.passkey ? 'One or more passkeys registered' : 'No passkeys registered'}
          action={
            passkeySupported ? (
              <Button variant="secondary" size="sm" onClick={actions.handleRegisterPasskey} loading={loading}>
                Add Passkey
              </Button>
            ) : null
          }
        />

        <Separator />

        <SettingsRow
          icon={<icons.Shield />}
          label="Master Password"
          description={session?.credentials?.password ? 'Password is set' : 'No password set'}
          action={
            session?.credentials?.password ? (
              <Button variant="secondary" size="sm" onClick={() => navigate('/password/change')} disabled={loading}>
                Change
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate('/password/add')} disabled={loading}>
                Add Password
              </Button>
            )
          }
        />

        {!passkeySupported && !session?.credentials?.password && (
          <>
            <Separator />
            <div className="px-4 py-3">
              <Alert variant="info">
                <AlertDescription>Add at least one authentication method to protect your vault.</AlertDescription>
              </Alert>
            </div>
          </>
        )}
      </SettingsSection>

      {/* Notifications */}
      <SettingsSection label="NOTIFICATIONS">
        <SettingsRow
          icon={<icons.Bell />}
          label="Notify Server URL"
          description={effectiveNotificationServerUrl}
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate('/notify-server/change')} disabled={loading}>
              Change
            </Button>
          }
        />
      </SettingsSection>

      {/* Account Settings */}
      <SettingsSection label="ACCOUNT">
        <SettingsRow
          icon={<icons.Mail />}
          label="Email address"
          description={session?.email}
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate('/email/change')} disabled={loading}>
              Change
            </Button>
          }
        />
      </SettingsSection>
    </div>
  )
}
