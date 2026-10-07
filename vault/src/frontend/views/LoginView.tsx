import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {OptionCard} from '@/frontend/components/OptionCard'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'
import {Fingerprint, Lock} from 'lucide-react'

/**
 * Sign in passkey or password options for an existing user.
 */
export function LoginView() {
  const {
    email,
    loading,
    error,
    passkeySupported,
    session,
    sessionChecked,
    userHasPassword,
    userHasPasskey,
    vaultConnectionRequest,
  } = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  // This view needs flow state that lives only in memory (the email and
  // credential flags from preLogin, or from a remembered session). On a fresh
  // page load without either — e.g. reloading /login while logged out — none
  // of it exists, so wait for the session check and then restart at pre-login.
  if (!sessionChecked) {
    return null
  }
  if (!email) {
    return <navigation.HashNavigate to="/" replace />
  }

  const connectingDesktop = vaultConnectionRequest && !vaultConnectionRequest.siteName

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-left text-xl">
          {connectingDesktop ? (
            'Connect your desktop app'
          ) : (
            <>
              Good to see you again <span aria-hidden>👋</span>
            </>
          )}
        </CardTitle>
        <CardDescription className="text-left">
          {connectingDesktop ? (
            `Sign in to ${email} to continue connecting this vault.`
          ) : (
            <>
              <span className="text-foreground font-medium">Confirm it's you.</span>
              <br />
              Signing in as {email}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorMessage message={error} />

        {passkeySupported && userHasPasskey ? (
          <OptionCard
            icon={Fingerprint}
            title="Sign in with passkey"
            disabled={loading}
            onClick={actions.handlePasskeyLogin}
          />
        ) : null}

        {userHasPassword ? (
          <OptionCard
            icon={Lock}
            title="Sign in with password"
            disabled={loading}
            onClick={() => {
              actions.setError('')
              navigate('/login/password')
            }}
          />
        ) : null}

        <Button
          variant="link"
          className="mt-4 w-full"
          onClick={() => {
            // A locked-but-authenticated session would bounce straight back
            // here from '/', so switching email means logging out first.
            if (session?.authenticated) {
              void actions.handleLogout()
              return
            }
            actions.setEmail('')
            navigate('/')
          }}
        >
          ← Use another email
        </Button>
      </CardContent>
    </Card>
  )
}
