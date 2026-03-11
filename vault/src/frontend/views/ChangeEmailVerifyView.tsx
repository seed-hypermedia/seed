import {useEffect} from 'react'
import {useParams} from 'react-router-dom'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Spinner} from '@/frontend/components/Spinner'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View shown when user clicks the email change magic link.
 * Shows confirmation that the email change was verified.
 */
export function ChangeEmailVerifyView() {
  const {newEmail, loading, error} = useAppState()
  const actions = useActions()
  const {challengeId, token} = useParams<{
    challengeId: string
    token: string
  }>()

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
              Email change to <strong>{newEmail}</strong> has been confirmed.
            </p>

            <p className="mt-6 text-center opacity-80">You can now close this window.</p>
          </>
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
