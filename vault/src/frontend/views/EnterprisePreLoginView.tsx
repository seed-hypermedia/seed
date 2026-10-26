import {WebAuthnAbortService} from '@simplewebauthn/browser'
import type React from 'react'
import {useEffect, useRef, useState} from 'react'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import * as navigation from '@/frontend/navigation'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Login-first email entry for invitation-only enterprise vaults.
 * Attempts conditional mediation (passkey autofill) on mount so that users
 * with resident passkeys can sign in without typing their email.
 */
export function EnterprisePreLoginView() {
  const {
    email,
    relyingPartyName,
    inviteOnly,
    inviteCode,
    loading,
    error,
    passkeySupported,
    session,
    sessionChecked,
    delegationRequest,
    vaultConnectionRequest,
  } = useAppState()
  const actions = useActions()
  const autoSubmittedRef = useRef(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [registrationEmail, setRegistrationEmail] = useState('')
  const needsInvitation = creatingAccount && inviteOnly && registrationEmail === email && !!registrationEmail

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const showEmailError = emailTouched && email.trim().length > 0 && !emailValid

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
      actions.handlePreLogin({signInOnly: true})
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
    if (!emailValid) {
      setEmailTouched(true)
      return
    }
    const accepted = await actions.handlePreLogin({
      signInOnly: !creatingAccount,
      checkRegistration: creatingAccount && inviteOnly && !needsInvitation,
    })
    if (accepted) setRegistrationEmail(email.trim().toLowerCase())
  }

  return (
    <Card>
      <CardHeader>
        {creatingAccount && <StepIndicator currentStep={1} />}
        {creatingAccount ? (
          <>
            <CardTitle className="text-left text-xl">Create your account</CardTitle>
            <CardDescription className="text-left">
              {inviteOnly
                ? needsInvitation
                  ? 'Enter the invitation code for this email.'
                  : 'Enter your email to get started.'
                : 'We’ll verify your email before you choose a password or passkey.'}
            </CardDescription>
          </>
        ) : vaultConnectionRequest?.siteName ? (
          <>
            <CardTitle className="text-left text-xl">Sign in to join {vaultConnectionRequest.siteName}</CardTitle>
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
            <CardTitle className="text-left text-xl">
              {relyingPartyName ? `Sign in to ${relyingPartyName}` : 'Sign in'}
            </CardTitle>
            <CardDescription className="text-left">Use your password or passkey.</CardDescription>
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
              onChange={(e) => {
                setRegistrationEmail('')
                actions.setInviteCode('')
                actions.setEmail(e.target.value)
              }}
              onBlur={() => setEmailTouched(true)}
              aria-invalid={showEmailError}
              className={showEmailError ? 'border-destructive focus-visible:border-destructive' : undefined}
              autoFocus
              autoComplete="username webauthn"
            />
            {showEmailError ? <p className="text-destructive text-sm">That doesn't look like a valid email</p> : null}
          </div>

          {needsInvitation && (
            <div className="space-y-2">
              <Label htmlFor="invite">Invitation code</Label>
              <Input
                id="invite"
                name="invite"
                type="text"
                placeholder="Paste your invitation code"
                value={inviteCode}
                onChange={(e) => actions.setInviteCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-sm">
                An invitation is required to create an account. You do not need one to sign in.
              </p>
            </div>
          )}

          {creatingAccount && (!inviteOnly || needsInvitation) && (
            <div className="space-y-2">
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
          )}

          <Button
            type="submit"
            loading={loading}
            disabled={!emailValid || (needsInvitation && !inviteCode.trim())}
            className="w-full"
          >
            Continue
          </Button>
        </form>

        {!creatingAccount && passkeySupported && (
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
        <div className="mt-6 border-t pt-4 text-center">
          <Button
            type="button"
            variant="link"
            disabled={loading}
            onClick={() => {
              actions.setError('')
              actions.setInviteCode('')
              setRegistrationEmail('')
              setCreatingAccount(!creatingAccount)
            }}
          >
            {creatingAccount ? 'Already have an account? Sign in' : 'Create account'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
