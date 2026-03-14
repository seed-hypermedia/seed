import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View for choosing authentication method during registration (Step 2 of 3).
 */
export function ChooseAuthView() {
  const {loading, error, passkeySupported} = useAppState()
  const actions = useActions()

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
              Not familiar with passkey?{' '}
              <a
                href="https://hyper.media/passkeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-600 underline underline-offset-2 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                Learn how it works
              </a>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
