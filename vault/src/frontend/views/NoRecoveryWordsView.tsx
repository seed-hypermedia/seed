import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {OptionCard} from '@/frontend/components/OptionCard'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'
import {Fingerprint, UserPlus, X} from 'lucide-react'

/**
 * Last resort options for a user without password or recovery words.
 */
export function NoRecoveryWordsView() {
  const {email, loading, error, passkeySupported, userHasPasskey, session, sessionChecked} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  if (!sessionChecked) {
    return null
  }
  if (!email) {
    return <navigation.HashNavigate to="/" replace />
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-left text-xl">Don't have your recovery words?</CardTitle>
          <button
            type="button"
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground -mr-1 cursor-pointer transition-colors"
            onClick={() => navigate('/')}
          >
            <X className="size-5" />
          </button>
        </div>
        <CardDescription className="text-left">
          {passkeySupported && userHasPasskey
            ? 'You can still get in with a passkey.'
            : 'Without your password or recovery words, this account can’t be recovered.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorMessage message={error} />

        {passkeySupported && userHasPasskey ? (
          <OptionCard
            icon={Fingerprint}
            title="Sign in with passkey"
            description="If you set up a passkey on this device, you can still access your account."
            recommended
            disabled={loading}
            onClick={actions.handlePasskeyLogin}
          />
        ) : null}

        <OptionCard
          icon={UserPlus}
          title="Create a new account"
          description="You won’t have access to this account or its data anymore. You’ll start over with a different email."
          disabled={loading}
          onClick={() => {
            if (session?.authenticated) {
              void actions.handleLogout()
              return
            }
            actions.setEmail('')
            navigate('/')
          }}
        />

        <Button
          variant="link"
          className="mt-2 w-full"
          disabled={loading}
          onClick={() => {
            actions.setError('')
            navigate('/login/recover')
          }}
        >
          ← Back
        </Button>
      </CardContent>
    </Card>
  )
}
