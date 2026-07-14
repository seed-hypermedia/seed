import {WebAuthnAbortService} from '@simplewebauthn/browser'
import type React from 'react'
import {useEffect, useRef} from 'react'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import * as navigation from '@/frontend/navigation'
import {SeedLogo} from '@/frontend/components/SeedLogo'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Initial view for email entry before sign in/registration.
 * Attempts conditional mediation (passkey autofill) on mount so that users
 * with resident passkeys can sign in without typing their email.
 */
export function PreLoginView() {
  const {email, loading, error, passkeySupported, session, sessionChecked, delegationRequest, vaultConnectionRequest} =
    useAppState()
  const actions = useActions()
  const autoSubmittedRef = useRef(false)

  useEffect(() => {
    if (sessionChecked) {
      actions.handleConditionalLogin()
    }
    return () => WebAuthnAbortService.cancelCeremony()
  }, [actions, sessionChecked])

  // Auto-submit only when the delegation URL provided the matching email.
  useEffect(() => {
    if (
      sessionChecked &&
      !session?.authenticated &&
      delegationRequest?.email &&
      email === delegationRequest.email &&
      !loading &&
      !autoSubmittedRef.current
    ) {
      autoSubmittedRef.current = true
      actions.handlePreLogin()
    }
  }, [sessionChecked, session, delegationRequest, email, loading, actions])

  if (!sessionChecked) {
    return null
  }

  if (session?.authenticated) {
    return <navigation.HashNavigate to="/" replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await actions.handlePreLogin()
  }

  const delegationSiteName = delegationRequest
    ? delegationRequest.siteName || new URL(delegationRequest.clientId).host
    : null

  return (
    <Card>
      <CardHeader>
        {delegationRequest ? (
          <>
            <CardTitle className="flex items-center gap-2 text-left text-xl">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600">
                <SeedLogo className="size-4 text-white" />
              </div>
              Sign in to join {delegationSiteName}
            </CardTitle>
            <CardDescription className="text-left">Enter the email linked to your Hypermedia identity.</CardDescription>
          </>
        ) : vaultConnectionRequest ? (
          <>
            <CardTitle className="text-left text-xl">Connect your desktop app</CardTitle>
            <CardDescription className="text-left">
              Sign in to continue connecting this vault to Seed desktop.
            </CardDescription>
          </>
        ) : (
          <>
            <CardTitle className="text-left text-xl">Sign In</CardTitle>
            <CardDescription className="text-left">Enter your email to continue</CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent>
        <ErrorMessage message={error} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{delegationRequest ? 'Enter your email to continue' : 'Email address'}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={delegationRequest ? 'Enter your email' : 'you@example.com'}
              value={email}
              onChange={(e) => actions.setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username webauthn"
            />
          </div>

          <Button type="submit" loading={loading} className="w-full">
            Continue
          </Button>
        </form>

        {passkeySupported && (
          <p className="text-muted-foreground mt-4 text-center text-sm">
            <button
              type="button"
              className="hover:text-foreground cursor-pointer underline underline-offset-2 transition-colors"
              onClick={actions.handleModalPasskeyLogin}
              disabled={loading}
            >
              Sign in with a passkey
            </button>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
