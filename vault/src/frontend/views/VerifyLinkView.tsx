import {useEffect} from 'react'
import {useParams} from 'react-router-dom'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Spinner} from '@/frontend/components/Spinner'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {useActions, useAppState} from '@/frontend/store'

/**
 * View shown when user clicks the magic link from their email.
 * Shows confirmation that verification succeeded.
 */
export function VerifyLinkView() {
  const {email, loading, error} = useAppState()
  const actions = useActions()
  const {challengeId, token} = useParams<{
    challengeId: string
    token: string
  }>()

  useEffect(() => {
    if (challengeId && token) {
      actions.handleVerifyLink(challengeId, token)
    }
  }, [actions, challengeId, token])

  const title = loading ? 'Verifying...' : error ? 'Verification Failed' : 'Email Verified!'

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
              <div className="bg-brand-6 mx-auto flex size-15 items-center justify-center rounded-full text-3xl text-white">
                ✓
              </div>
            </div>

            <p className="text-muted-foreground mb-8 text-center">
              Your email <strong>{email}</strong> has been verified.
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
