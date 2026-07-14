import {WebAuthnAbortService} from '@simplewebauthn/browser'
import type React from 'react'
import {useEffect, useRef} from 'react'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import * as navigation from '@/frontend/navigation'
import {StepIndicator} from '@/frontend/components/StepIndicator'
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

  return (
    <Card>
      <CardHeader>
        <StepIndicator currentStep={1} />
        {vaultConnectionRequest ? (
          <>
            <CardTitle className="text-left text-xl">Connect your desktop app</CardTitle>
            <CardDescription className="text-left">
              Sign in to continue connecting this vault to Seed desktop.
            </CardDescription>
          </>
        ) : (
          <>
            <CardTitle className="text-left text-xl">What's your email?</CardTitle>
            <CardDescription className="text-left">We'll send a verification code.</CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent>
        <ErrorMessage message={error} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Enter your email to continue</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => actions.setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username webauthn"
            />
            <p className="text-muted-foreground text-sm">
              By continuing, you agree to our{' '}
              <a
                href="https://hyper.media/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:opacity-80"
              >
                Terms and Privacy Policy
              </a>
              .
            </p>
          </div>

          <Button type="submit" loading={loading} className="w-full">
            Send code
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
