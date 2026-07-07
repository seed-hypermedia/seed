import {useEffect, useState, type FormEvent} from 'react'
import {Button} from '../button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog'
import {checkPasswordStrength, PasswordInput} from './password-input'

/**
 * Shared "set / change password" dialog used by both the desktop app and
 * the web vault. The dialog collects and validates the new password (match +
 * minimum strength); the platform performs the actual key derivation / DEK
 * wrapping inside `onSubmit` (the desktop daemon does it with the in-daemon DEK;
 * the web vault does it in-browser), so the UX stays identical.
 */
export function SetMasterPasswordDialog({
  open,
  onOpenChange,
  mode,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'set' when no password exists yet, 'change' to replace an existing one. */
  mode: 'set' | 'change'
  onSubmit: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setConfirmPassword('')
    setError(null)
    setIsSubmitting(false)
  }, [open])

  const title = mode === 'change' ? 'Change Password' : 'Set Password'
  const submitLabel = mode === 'change' ? 'Change Password' : 'Set Password'

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault()
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (checkPasswordStrength(password) === 0) {
      setError('Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols.')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit(password)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save password')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Your password protects your vault. Choose a strong password you won't forget — it can't be recovered.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <PasswordInput
            id="master-password"
            label={mode === 'change' ? 'New Password' : 'Password'}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            autoFocus
            showStrength
          />
          <PasswordInput
            id="master-password-confirm"
            label="Confirm Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !password || !confirmPassword}>
              {isSubmitting ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
