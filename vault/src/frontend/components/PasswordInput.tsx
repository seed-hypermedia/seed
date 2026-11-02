import {Button} from '@/frontend/components/ui/button'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import * as sharedPassword from '@shm/ui/components/password-input'
import {Eye, EyeOff} from 'lucide-react'
import {useState} from 'react'

interface PasswordInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  autoFocus?: boolean
  showStrength?: boolean
  placeholder?: string
  error?: string
}

const strengthConfig: Record<number, {className: string; scaleX: number}> = {
  0: {className: 'bg-destructive', scaleX: 1 / 3},
  1: {className: 'bg-brand-3', scaleX: 2 / 3},
  2: {className: 'bg-brand-6', scaleX: 1},
}

/**
 * Password input with visibility toggle and optional strength meter.
 */
export function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  showStrength,
  placeholder = 'Enter password',
  error,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)
  const strength = showStrength ? sharedPassword.checkPasswordStrength(value) : 0
  const {className: strengthBarClass, scaleX: strengthScaleX} = strengthConfig[strength]!

  return (
    <div className="mb-4 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={autoComplete === 'new-password' ? 'new-password' : 'password'}
          type={showPassword ? 'text' : 'password'}
          className="pr-10"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
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
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {showStrength && value ? (
        <div className="mt-2 h-1 overflow-hidden rounded-sm bg-black/10 dark:bg-white/10">
          <div
            className={`h-full w-full origin-left transition-[transform,background-color] duration-300 ${strengthBarClass}`}
            style={{transform: `scaleX(${strengthScaleX})`}}
          />
        </div>
      ) : null}
    </div>
  )
}
