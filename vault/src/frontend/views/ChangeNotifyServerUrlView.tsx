import * as React from 'react'
import * as ReactRouter from 'react-router-dom'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View for changing the notify server URL stored in the encrypted vault.
 */
export function ChangeNotifyServerUrlView() {
  const {loading, error, notificationServerUrl, vaultData} = useAppState()
  const actions = useActions()
  const navigate = ReactRouter.useNavigate()
  const savedNotificationServerUrl = vaultData?.notificationServerUrl?.trim() || ''
  const effectiveNotificationServerUrl = savedNotificationServerUrl || notificationServerUrl
  const [nextNotificationServerUrl, setNextNotificationServerUrl] = React.useState(savedNotificationServerUrl)
  const hasChanges = nextNotificationServerUrl.trim() !== savedNotificationServerUrl

  React.useEffect(() => {
    setNextNotificationServerUrl(savedNotificationServerUrl)
  }, [savedNotificationServerUrl])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const didSave = await actions.saveNotificationServerUrl(nextNotificationServerUrl)
    if (didSave) {
      navigate('/settings')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">Change Notify Server URL</CardTitle>
        <CardDescription className="text-center">
          Current URL: <strong>{effectiveNotificationServerUrl}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ErrorMessage message={error} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notify-server-url">Notify Server URL</Label>
            <Input
              id="notify-server-url"
              type="url"
              placeholder="Leave empty to use the server default"
              value={nextNotificationServerUrl}
              onChange={(event) => setNextNotificationServerUrl(event.target.value)}
              disabled={loading || !vaultData}
            />
            <p className="text-muted-foreground text-xs">
              Server default:
              <span className="text-foreground ml-1 font-mono break-all">{notificationServerUrl}</span>
            </p>
          </div>

          <Button type="submit" disabled={loading || !vaultData || !hasChanges} className="w-full">
            Save Notify Server URL
          </Button>
        </form>

        <Button variant="secondary" className="mt-4 w-full" onClick={() => navigate('/settings')} disabled={loading}>
          Cancel
        </Button>
      </CardContent>
    </Card>
  )
}
