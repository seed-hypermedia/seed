import {useState} from 'react'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/frontend/components/ui/dialog'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {useActions, useAppState} from '@/frontend/store'
import {Eye, EyeOff} from 'lucide-react'

const requirements = [
  {label: 'At least one lowercase letter', test: (pw: string) => /[a-z]/.test(pw)},
  {label: 'Minimum 8 characters', test: (pw: string) => pw.length >= 8},
  {label: 'At least one uppercase letter', test: (pw: string) => /[A-Z]/.test(pw)},
  {label: 'At least one number', test: (pw: string) => /[0-9]/.test(pw)},
]

export function CreatePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const {email, loading, error} = useAppState()
  const actions = useActions()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)

  const allRequirementsMet = requirements.every((req) => req.test(password))
  const canSubmit = allRequirementsMet && acceptedTerms && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    actions.setPassword(password)
    actions.setConfirmPassword(password)
    await actions.handleSetPassword()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setPassword('')
      setShowPassword(false)
      setAcceptedTerms(false)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create your password</DialogTitle>
          <DialogDescription>Please enter your new password to secure your account.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <ErrorMessage message={error} />

          {/* Hidden username field for password manager autofill */}
          <input
            type="text"
            name="username"
            value={email}
            autoComplete="username"
            className="pointer-events-none absolute m-0 h-0 w-0 opacity-0"
            readOnly
            tabIndex={-1}
          />

          <div className="space-y-2">
            <Label htmlFor="create-password">Add your password</Label>
            <div className="relative">
              <Input
                id="create-password"
                name="new-password"
                type={showPassword ? 'text' : 'password'}
                className="pr-10"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                autoFocus
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 h-full w-10 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="text-muted-foreground size-4" />
                ) : (
                  <Eye className="text-muted-foreground size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Live requirements checklist */}
          <ul className="space-y-1 text-sm">
            {requirements.map((req) => {
              const met = password.length > 0 && req.test(password)
              return (
                <li
                  key={req.label}
                  className={password.length > 0 ? (met ? 'text-brand-6' : 'text-destructive') : 'text-muted-foreground'}
                >
                  {password.length > 0 ? (met ? '✓' : '✗') : '•'} {req.label}
                </li>
              )
            })}
          </ul>

          {/* Terms and conditions */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-brand-6 rounded"
            />
            <span>
              I accept Hypermedia{' '}
              <a href="#" className="text-brand-6 underline underline-offset-2">
                Terms and conditions
              </a>{' '}
              and its{' '}
              <a href="#" className="text-brand-6 underline underline-offset-2">
                Privacy policy
              </a>
            </span>
          </label>

          <Button type="submit" className="w-full" disabled={!canSubmit} loading={loading}>
            Continue
          </Button>

          <button
            type="button"
            className="text-muted-foreground hover:text-foreground w-full text-center text-sm transition-colors"
            onClick={() => handleOpenChange(false)}
          >
            ← Back
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
