import {type FormEvent, useEffect, useState} from 'react'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import * as navigation from '@/frontend/navigation'
import {Alert, AlertDescription} from '@/frontend/components/ui/alert'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Label} from '@/frontend/components/ui/label'
import {CodeInput} from '@/frontend/components/CodeInput'
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

  return <p className="mt-2 text-sm opacity-80">Code expires in {formattedTime}</p>
}

/** View shown while waiting for the user to enter an email-change verification code. */
export function ChangeEmailPendingView() {
  const {newEmail, error, loading, verificationExpireTime} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const [code, setCode] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    actions.handleChangeEmailVerify(code)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">Verify New Email</CardTitle>
        <CardDescription className="text-center">
          We sent a verification code to <strong>{newEmail}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="info" className="my-6">
          <AlertDescription>
            <p>Enter the code from your email to confirm the change.</p>
            <Countdown expireTime={verificationExpireTime || Date.now() + 15 * 60 * 1000} />
          </AlertDescription>
        </Alert>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Verification code</Label>
            <CodeInput value={code} onChange={(newCode) => setCode(newCode)} />
          </div>

          <Button type="submit" loading={loading} disabled={code.length !== 4} className="w-full">
            Verify email
          </Button>
        </form>

        <Button
          variant="ghost"
          className="mt-4 w-full"
          onClick={() => actions.handleStartEmailChange()}
          disabled={loading}
        >
          Request a new code
        </Button>

        <ErrorMessage message={error} />

        <Button variant="secondary" className="mt-6 w-full" onClick={() => navigate('/')}>
          Cancel
        </Button>
      </CardContent>
    </Card>
  )
}
