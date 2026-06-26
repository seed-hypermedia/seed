import {useEffect, useState, type FormEvent} from 'react'
import {Button} from '../button'
import {CodeInput} from './code-input'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog'
import {Input} from './input'
import {Label} from './label'

/**
 * Shared two-step "change email" dialog used by both the desktop app and the
 * web vault. The dialog owns the step/form state, the verification-code input,
 * the expiry countdown, and error/loading display; the platform injects the two
 * async actions:
 *
 * - `onStart(newEmail)` sends the verification code (returns the code expiry).
 * - `onVerify(code)` confirms the code and applies the change.
 *
 * Each platform handles its own transport/auth inside those callbacks (the
 * desktop daemon carries an anti-phishing binding between the two calls; the
 * web vault carries it in an httpOnly cookie), so the UX stays identical.
 */
export function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
  onStart,
  onVerify,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentEmail?: string
  onStart: (newEmail: string) => Promise<{expireTimeMs?: number} | void>
  onVerify: (code: string) => Promise<void>
}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [expireTimeMs, setExpireTimeMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep('email')
    setNewEmail('')
    setCode('')
    setExpireTimeMs(0)
    setError(null)
    setIsStarting(false)
    setIsVerifying(false)
  }, [open])

  async function start(e?: FormEvent) {
    e?.preventDefault()
    if (!newEmail.trim()) return
    setError(null)
    setIsStarting(true)
    try {
      const result = await onStart(newEmail.trim())
      setExpireTimeMs(result?.expireTimeMs ?? 0)
      setCode('')
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code')
    } finally {
      setIsStarting(false)
    }
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault()
    if (code.length !== 4) return
    setError(null)
    setIsVerifying(true)
    try {
      await onVerify(code)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        {step === 'email' ? (
          <>
            <DialogHeader>
              <DialogTitle>Change Email Address</DialogTitle>
              <DialogDescription>
                {currentEmail ? <>Current email: {currentEmail}</> : 'Enter the new email for your vault.'}
              </DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={start}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="change-email-new">New Email Address</Label>
                <Input
                  id="change-email-new"
                  type="email"
                  placeholder="Enter your new email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={isStarting}
                  autoFocus
                  required
                />
              </div>
              {error ? <p className="text-destructive text-sm">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isStarting || !newEmail.trim()}>
                  {isStarting ? 'Sending…' : 'Send Verification Link'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Verify New Email</DialogTitle>
              <DialogDescription>
                We sent a verification code to <span className="font-medium">{newEmail}</span>
              </DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={verify}>
              <div className="flex flex-col gap-2">
                <Label className="text-center">Verification code</Label>
                <CodeInput value={code} onChange={setCode} />
                <ExpiryHint expireTimeMs={expireTimeMs} />
              </div>
              {error ? <p className="text-destructive text-center text-sm">{error}</p> : null}
              <Button type="submit" disabled={code.length !== 4 || isVerifying}>
                {isVerifying ? 'Verifying…' : 'Verify email'}
              </Button>
              <Button type="button" variant="ghost" disabled={isStarting} onClick={() => start()}>
                {isStarting ? 'Sending…' : 'Request a new code'}
              </Button>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStep('email')}>
                  Back
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ExpiryHint({expireTimeMs}: {expireTimeMs: number}) {
  const [remaining, setRemaining] = useState<number>(() => Math.max(0, expireTimeMs - Date.now()))

  useEffect(() => {
    if (!expireTimeMs) return
    setRemaining(Math.max(0, expireTimeMs - Date.now()))
    const interval = setInterval(() => {
      setRemaining(Math.max(0, expireTimeMs - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [expireTimeMs])

  if (!expireTimeMs) return null
  if (remaining <= 0) {
    return <p className="text-muted-foreground text-center text-xs">Code expired. Request a new one.</p>
  }
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return (
    <p className="text-muted-foreground text-center text-xs">
      Code expires in {minutes}:{seconds.toString().padStart(2, '0')}
    </p>
  )
}
