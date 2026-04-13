import * as icons from 'lucide-react'
import * as navigation from '@/frontend/navigation'
import {Alert, AlertDescription} from '@/frontend/components/ui/alert'
import {Button} from '@/frontend/components/ui/button'
import {Separator} from '@/frontend/components/ui/separator'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Vault-level settings view for managing authentication credentials and account settings.
 * These settings apply to the entire vault, not individual Hypermedia accounts.
 */
export function SettingsView() {
  const {session, loading, passkeySupported, notificationServerUrl, vaultData} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const effectiveNotificationServerUrl = vaultData?.notificationServerUrl?.trim() || notificationServerUrl

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-muted-foreground text-sm">Manage authentication and security for your vault</p>
      </div>

      {/* Authentication Methods */}
      <SettingsSection label="AUTHENTICATION">
        <SettingsRow
          icon={icons.Key}
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
          icon={icons.Shield}
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
          icon={icons.Bell}
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
          icon={icons.Mail}
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

function SettingsSection({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div>
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">{label}</p>
      <div className="bg-muted/50 overflow-hidden rounded-lg border">{children}</div>
    </div>
  )
}

function SettingsRow({
  icon: Icon,
  label,
  description,
  action,
}: {
  icon: React.ComponentType<{className?: string}>
  label: string
  description?: string | null
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 flex size-9 shrink-0 items-center justify-center rounded-full">
          <Icon className="text-primary size-4" />
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium">{label}</p>
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
