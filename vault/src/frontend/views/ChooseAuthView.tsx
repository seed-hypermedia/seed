import {Divider} from '@/frontend/components/Divider'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View for choosing authentication method during registration (Step 3 of 4).
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
        <StepIndicator currentStep={3} />
        <CardTitle className="text-left text-xl">
          {passkeySupported ? 'Set up your passkey' : 'Secure your account'}
        </CardTitle>
        <CardDescription className="text-left">
          {passkeySupported
            ? 'Faster, safer, no password to remember. Sign in securely using your device (Face ID, Touch ID, or screen lock).'
            : 'Create a password to protect your vault and sign in with your email.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorMessage message={error} />

        {passkeySupported && (
          <div className="space-y-3">
            <Button onClick={actions.handleSetPasskey} loading={loading} className="w-full">
              Create a passkey
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              <a
                href="https://www.passkeys.com/what-are-passkeys.html"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground underline underline-offset-2 transition-colors"
              >
                What is a passkey?
              </a>
            </p>
          </div>
        )}

        {passwordVisible && (
          <>
            {passkeySupported && <Divider>or</Divider>}
            <Button
              variant={passkeySupported ? 'secondary' : 'default'}
              disabled={loading}
              onClick={() => {
                actions.setError('')
                navigate('/password/set')
              }}
              className="w-full"
            >
              Use password
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
