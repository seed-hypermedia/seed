import {useCallback, useEffect} from 'react'
import {useParams} from 'react-router-dom'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import * as navigation from '@/frontend/navigation'
import {Spinner} from '@/frontend/components/Spinner'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View shown when user clicks the email change magic link.
 * Shows confirmation that the email change was verified.
 */
export function ChangeEmailVerifyView() {
  const {newEmail, loading, error} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const {challengeId, token} = useParams<{
    challengeId: string
    token: string
  }>()

  const handleBackToLogin = useCallback(() => {
    window.close()
    // window.close() is blocked by browsers for tabs not opened via window.open().
    // Fall back to navigating to the login screen.
    setTimeout(() => navigate('/'), 100)
  }, [navigate])

  useEffect(() => {
    if (challengeId && token) {
      actions.handleVerifyEmailChangeLink(challengeId, token)
    }
  }, [actions, challengeId, token])

  const title = loading ? 'Verifying...' : error ? 'Verification Failed' : 'Email Change Verified!'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ErrorMessage message={error} />

        {!loading && !error && (
          <>
            <div className="my-6 text-center">
              <div className="bg-brand-6 text-primary-foreground mx-auto flex size-15 items-center justify-center rounded-full text-3xl">
                ✓
              </div>
            </div>

            <p className="text-muted-foreground mb-8 text-center">
              Email change to <strong>{newEmail}</strong> has been confirmed. You can close this tab now.
            </p>
          </>
        )}

        {error && (
          <Button variant="ghost" className="mt-6 w-full" onClick={handleBackToLogin}>
            ← Back to login screen
          </Button>
        )}

        {loading && (
          <div className="my-8 flex justify-center">
            <Spinner size="lg" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
