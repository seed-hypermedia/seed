import type React from 'react'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Screen for someone who opened an invitation link (`?invite=<code>&email=…`).
 * The invitation is scoped to one email, so the address is shown but not
 * editable, the code never appears, and the only action is to continue into
 * the regular email-verification and credential-creation steps.
 */
export function InvitedView() {
  const {inviteEmail, inviteStatus, relyingPartyName, loading, error} = useAppState()
  const actions = useActions()

  const siteName = relyingPartyName || (typeof window !== 'undefined' ? window.location.host : '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void actions.handleInvitedContinue()
  }

  return (
    <Card>
      <CardHeader>
        <StepIndicator currentStep={1} />
        <CardTitle className="text-left text-xl">You&apos;ve been invited</CardTitle>
        {siteName ? <CardDescription className="text-left">to {siteName}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {inviteStatus === 'invalid' ? (
          <p className="text-muted-foreground text-sm">
            This invitation was already used or is invalid. Ask the person who invited you for a new link.
          </p>
        ) : inviteStatus === 'failed' ? (
          <p className="text-muted-foreground text-sm">
            We couldn&apos;t check this invitation right now. Reload the page to try again.
          </p>
        ) : (
          <>
            <ErrorMessage message={error} />

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invited-email">Your email</Label>
                <Input
                  id="invited-email"
                  name="email"
                  type="email"
                  value={inviteEmail}
                  readOnly
                  aria-readonly="true"
                  tabIndex={-1}
                  className="bg-muted text-muted-foreground cursor-default"
                />
                <p className="text-muted-foreground text-sm">
                  {inviteStatus === 'checking' && !inviteEmail
                    ? 'Checking your invitation…'
                    : 'Continue to create your account for this address.'}
                </p>
              </div>

              <Button
                type="submit"
                loading={loading || inviteStatus === 'checking'}
                disabled={inviteStatus !== 'valid'}
                className="w-full"
              >
                Continue
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  )
}
