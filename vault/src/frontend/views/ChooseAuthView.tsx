import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {FlowHeader} from '@/frontend/components/FlowHeader'
import {OptionCard} from '@/frontend/components/OptionCard'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'
import {Fingerprint, Lock} from 'lucide-react'

/**
 * View for choosing how to secure the account during registration.
 * The passkey and password are offered as first-class options.
 */
export function ChooseAuthView() {
  const {loading, error, passkeySupported} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  return (
    <Card>
      <CardHeader>
        <FlowHeader step={2} />
        <CardTitle className="text-left text-xl">Pick how to secure your account</CardTitle>
        <CardDescription className="text-left">Your data will be protected by encryption.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorMessage message={error} />

        <OptionCard
          icon={Fingerprint}
          title="Use a passkey"
          badge={passkeySupported ? 'Recommended' : undefined}
          description={
            passkeySupported
              ? 'Sign in securely using your device (Face ID, Touch ID, or screen lock).'
              : 'Your device does not support Passkey, please add password instead.'
          }
          recommended={passkeySupported}
          disabled={!passkeySupported || loading}
          onClick={actions.handleSetPasskey}
        />

        <OptionCard
          icon={Lock}
          title="Use a password"
          description="Create a password to create account."
          disabled={loading}
          onClick={() => {
            actions.setError('')
            navigate('/password/set')
          }}
        />
      </CardContent>
    </Card>
  )
}
