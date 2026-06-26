import {Eye, EyeOff} from 'lucide-react'
import {useState} from 'react'
import {Button} from '../button'
import {Input} from './input'
import {Label} from './label'

/**
 * Rates a password 0 (weak) / 1 (medium) / 2 (strong). Shared with the web vault
 * so the desktop and vault enforce the same minimum strength.
 */
export function checkPasswordStrength(password: string): number {
  if (password.length < 8) return 0

  let score = 0
  if (password.length >= 12) score++
  if (password.length >= 16) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  if (score <= 1) return 0
  if (score <= 3) return 1
  return 2
}

const strengthConfig: Record<number, string> = {
  0: 'w-1/3 bg-destructive',
  1: 'w-2/3 bg-yellow-500',
  2: 'w-full bg-green-500',
}

/**
 * Password input with a visibility toggle and optional strength meter. Shared
 * between the desktop app and the web vault.
 */
export function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  showStrength,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  autoFocus?: boolean
  showStrength?: boolean
}) {
  const [showPassword, setShowPassword] = useState(false)
  const strength = showStrength ? checkPasswordStrength(value) : 0

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={autoComplete === 'new-password' ? 'new-password' : 'password'}
          type={showPassword ? 'text' : 'password'}
          className="pr-10"
          placeholder="Enter password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 h-full w-10 hover:bg-transparent"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          title={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? (
            <EyeOff className="text-muted-foreground size-4" />
          ) : (
            <Eye className="text-muted-foreground size-4" />
          )}
        </Button>
      </div>
      {showStrength && value ? (
        <div className="bg-muted mt-1 h-1 overflow-hidden rounded-sm">
          <div className={`h-full transition-all duration-300 ${strengthConfig[strength]}`} />
        </div>
      ) : null}
    </div>
  )
}
