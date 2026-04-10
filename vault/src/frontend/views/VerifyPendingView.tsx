import {useEffect, useState} from 'react'
import {Alert, AlertDescription} from '@/frontend/components/ui/alert'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'

function Countdown({seconds}: {seconds: number}) {
  const [timeLeft, setTimeLeft] = useState(seconds)

  useEffect(() => {
    if (timeLeft <= 0) return

    const intervalId = setInterval(() => {
      setTimeLeft((t) => t - 1)
    }, 1000)

    return () => clearInterval(intervalId)
  }, [timeLeft])

  const minutes = Math.floor(timeLeft / 60)
  const remainingSeconds = timeLeft % 60
  const formattedTime = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`

  return <p className="text-muted-foreground text-xs">Link expires in {formattedTime}</p>
}

/**
 * View shown while waiting for the user to click the magic link.
 * Displays instructions while polling for verification in the background.
 */
export function VerifyPendingView() {
  const {email, error} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  return (
    <Card>
      <CardHeader>
        <StepIndicator currentStep={1} />
        <CardTitle className="text-left text-xl">Check your email</CardTitle>
        <CardDescription className="text-left">
          We've sent a verification link to <strong>{email}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border-muted-foreground/20 space-y-2 rounded-lg border p-4">
          <p className="text-sm">Click the link in the email to continue joining this site.</p>
          <p className="text-sm">
            Didn't get it? Check spam or{' '}
            <button
              type="button"
              className="text-primary underline hover:opacity-80"
              onClick={() => actions.handleStartRegistration()}
            >
              request a new link
            </button>
            .
          </p>
          <Countdown seconds={120} />
        </div>

        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button variant="ghost" className="mt-4 w-full" onClick={() => navigate('/')}>
          ← Back
        </Button>
      </CardContent>
    </Card>
  )
}
