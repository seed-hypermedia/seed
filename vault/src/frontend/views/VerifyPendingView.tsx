import {type FormEvent, useEffect, useState} from 'react'
import {Alert, AlertDescription} from '@/frontend/components/ui/alert'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Label} from '@/frontend/components/ui/label'
import {CodeInput} from '@shm/ui/components/code-input'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'

function Countdown({expireTime}: {expireTime: number}) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(intervalId)
  }, [])

  const timeLeft = Math.max(0, Math.ceil((expireTime - now) / 1000))
  const minutes = Math.floor(timeLeft / 60)
  const remainingSeconds = timeLeft % 60
  const formattedTime = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`

  return <p className="text-muted-foreground text-xs">Code expires in {formattedTime}</p>
}

/** View shown while waiting for the user to enter an email verification code. */
export function VerifyPendingView() {
  const {email, error, loading, verificationExpireTime} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const [code, setCode] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    actions.handleRegisterVerify(code)
  }

  return (
    <Card>
      <CardHeader>
        <StepIndicator currentStep={1} />
        <CardTitle className="text-left text-xl">Check your email</CardTitle>
        <CardDescription className="text-left">
          We've sent a verification code to <strong>{email}</strong>. Please enter it below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <CodeInput value={code} onChange={(newCode) => setCode(newCode)} />
          <Countdown expireTime={verificationExpireTime || Date.now() + 15 * 60 * 1000} />

          <Button type="submit" loading={loading} disabled={code.length !== 4} className="w-full">
            Verify email
          </Button>
        </form>

        <div className="border-muted-foreground/20 mt-4 space-y-2 rounded-lg border p-4">
          <p className="text-sm">
            Didn't get it? Check spam or{' '}
            <button
              type="button"
              className="text-primary underline hover:opacity-80"
              onClick={() => actions.handleStartRegistration()}
              disabled={loading}
            >
              request a new code
            </button>
            .
          </p>
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
