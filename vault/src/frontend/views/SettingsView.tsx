import * as icons from 'lucide-react'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import * as navigation from '@/frontend/navigation'
import {Alert, AlertDescription} from '@/frontend/components/ui/alert'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Separator} from '@/frontend/components/ui/separator'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Vault-level settings view for managing authentication credentials and account settings.
 * These settings apply to the entire vault, not individual Hypermedia accounts.
 */
export function SettingsView() {
  const {session, loading, error, passkeySupported, notificationServerUrl, vaultData} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const effectiveNotificationServerUrl = vaultData?.notificationServerUrl?.trim() || notificationServerUrl

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-xs" onClick={() => navigate('/')}>
          <icons.ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Vault Settings</h1>
          <p className="text-muted-foreground text-sm">Manage authentication and security for your vault</p>
        </div>
      </div>

      <ErrorMessage message={error} />

      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>
            Manage how you sign in and unlock your vault. Adding multiple methods helps with account recovery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 flex size-9 items-center justify-center rounded-full">
                <icons.Key className="text-primary size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Passkeys</p>
                <p className="text-muted-foreground text-xs">
                  {session?.credentials?.passkey ? 'One or more passkeys registered' : 'No passkeys registered'}
                </p>
              </div>
            </div>
            {passkeySupported && (
              <Button variant="secondary" size="sm" onClick={actions.handleRegisterPasskey} loading={loading}>
                Add Passkey
              </Button>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 flex size-9 items-center justify-center rounded-full">
                <icons.Shield className="text-primary size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Master Password</p>
                <p className="text-muted-foreground text-xs">
                  {session?.credentials?.password ? 'Password is set' : 'No password set'}
                </p>
              </div>
            </div>
            {session?.credentials?.password ? (
              <Button variant="secondary" size="sm" onClick={() => navigate('/password/change')} disabled={loading}>
                Change
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate('/password/add')} disabled={loading}>
                Add Password
              </Button>
            )}
          </div>

          {!passkeySupported && !session?.credentials?.password && (
            <>
              <Separator />
              <Alert variant="info">
                <AlertDescription>Add at least one authentication method to protect your vault.</AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Manage your vault notification settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="bg-primary/10 flex size-9 items-center justify-center rounded-full">
                <icons.Bell className="text-primary size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">Notify Server URL</p>
                <p className="text-muted-foreground font-mono text-xs break-all">{effectiveNotificationServerUrl}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/notify-server/change')} disabled={loading}>
              Change
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Manage your vault account settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 flex size-9 items-center justify-center rounded-full">
                <icons.Mail className="text-primary size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Email Address</p>
                <p className="text-muted-foreground text-xs">{session?.email}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/email/change')} disabled={loading}>
              Change
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
