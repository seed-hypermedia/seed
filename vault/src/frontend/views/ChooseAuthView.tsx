import {Divider} from '@/frontend/components/Divider'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View for choosing authentication method during registration (Step 2 of 3).
 */
export function ChooseAuthView() {
  const {loading, error, passkeySupported} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  // The password fallback is shown directly when passkeys aren't supported,
  // and otherwise appears once a passkey attempt fails.
  const passwordVisible = !passkeySupported || !!error

  return (
    <Card>
      <CardHeader>
        <StepIndicator currentStep={2} />
        <CardTitle className="text-left text-xl">Pick how to secure your account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ErrorMessage message={error} />

        {passkeySupported && (
          <div className="space-y-3">
            <div>
              <p className="font-semibold">Use a passkey</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Faster, safer, no password to remember. Sign in securely using your device (Face ID, Touch ID, or screen
                lock).
              </p>
            </div>
            <Button onClick={actions.handleSetPasskey} loading={loading} className="w-full">
              Use passkey
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              Not familiar with passkeys?{' '}
              <a
                href="https://www.passkeys.com/what-are-passkeys.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-600 underline underline-offset-2 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                Learn how they work.
              </a>
            </p>
          </div>
        )}

        {passwordVisible && (
          <>
            {passkeySupported && <Divider>or</Divider>}
            <div className="space-y-3">
              <div>
                <p className="font-semibold">Use a master password</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Create a password to protect your vault and sign in with your email.
                </p>
              </div>
              <Button
                variant={passkeySupported ? 'secondary' : 'default'}
                disabled={loading}
                onClick={() => {
                  actions.setError('')
                  navigate('/password/set')
                }}
                className="w-full"
              >
                Use a password
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
