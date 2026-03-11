import {useState} from 'react'
import {CreatePasswordDialog} from '@/frontend/components/CreatePasswordDialog'
import {Divider} from '@/frontend/components/Divider'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View for choosing authentication method during registration (Step 2 of 3).
 */
export function ChooseAuthView() {
  const {loading, error, passkeySupported} = useAppState()
  const actions = useActions()
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-left">
          <span className="text-muted-foreground font-normal">Step 2 of 3</span> — Pick how to secure your account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ErrorMessage message={error} />

        {passkeySupported && (
          <>
            <div className="space-y-3">
              <div>
                <p className="font-semibold">Use a passkey (Recommended)</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Faster, safer, no password to remember. Sign in securely using your device (Face ID, Touch ID, or
                  screen lock).
                </p>
              </div>
              <Button onClick={actions.handleSetPasskey} loading={loading} className="w-full">
                Use passkey
              </Button>
            </div>

            <Divider>Or</Divider>
          </>
        )}

        <div className="space-y-3">
          <div>
            <p className="font-semibold">Use a password</p>
            <p className="text-muted-foreground mt-1 text-sm">Create a password to sign in with email and password.</p>
          </div>
          <Button variant="outline" onClick={() => setShowPasswordDialog(true)} disabled={loading} className="w-full">
            Create password
          </Button>
        </div>

        <CreatePasswordDialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog} />
      </CardContent>
    </Card>
  )
}
