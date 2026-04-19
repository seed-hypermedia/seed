import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Consent screen for connecting this vault to the local desktop app.
 */
export function ConnectView() {
  const {error, loading, vaultConnectionInProgress} = useAppState()
  const actions = useActions()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-left text-xl">Connect your desktop app</CardTitle>
        <CardDescription className="text-left">
          Allow the Seed desktop app on this device to connect to this vault for remote sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ErrorMessage message={error} />

        <div className="bg-muted/40 space-y-2 rounded-lg border p-4 text-sm">
          <p>This grants the local desktop app access to a vault sync secret for this vault.</p>
          <p className="text-muted-foreground">
            You can disconnect the desktop app later from its Vault Backend settings.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            loading={vaultConnectionInProgress}
            disabled={loading}
            onClick={actions.completeVaultConnection}
          >
            Connect desktop
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={vaultConnectionInProgress || loading}
            onClick={actions.cancelVaultConnection}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
