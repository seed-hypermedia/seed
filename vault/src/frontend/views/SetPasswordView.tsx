import {FlowHeader} from '@/frontend/components/FlowHeader'
import {PasswordInput} from '@/frontend/components/PasswordInput'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as localCrypto from '@/frontend/crypto'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'
import {cn} from '@/frontend/utils'
import {Check} from 'lucide-react'
import type React from 'react'

/**
 * View for setting a password during registration.
 */
export function SetPasswordView() {
  const {email, password, confirmPassword, loading, error} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  const rules = localCrypto.getPasswordRules(password)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    actions.handleSetPassword()
  }

  return (
    <Card>
      <CardHeader>
        <FlowHeader step={3} />
        <CardTitle className="text-left text-xl">Create a password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Hidden username field for password manager autofill. */}
          <input
            type="text"
            name="username"
            value={email}
            autoComplete="username"
            className="pointer-events-none absolute m-0 h-0 w-0 opacity-0"
            readOnly
            tabIndex={-1}
          />

          <PasswordInput
            id="password"
            label="Password"
            value={password}
            onChange={(value) => {
              actions.setPassword(value)
              if (error) actions.setError('')
            }}
            autoComplete="new-password"
            autoFocus
            showStrength
          />

          <PasswordInput
            id="confirm-password"
            label="Confirm password"
            value={confirmPassword}
            onChange={(value) => {
              actions.setConfirmPassword(value)
              if (error) actions.setError('')
            }}
            autoComplete="new-password"
            error={error}
          />

          <ul className="space-y-2">
            {rules.map((rule) => (
              <li key={rule.label} className="flex items-center gap-2 text-sm">
                <Check className={cn('size-4 shrink-0', rule.met ? 'text-brand' : 'text-muted-foreground/40')} />
                <span className={rule.met ? 'text-foreground' : 'text-muted-foreground'}>{rule.label}</span>
              </li>
            ))}
          </ul>

          <Button type="submit" loading={loading} className="w-full">
            Continue
          </Button>
        </form>

        <Button
          variant="link"
          className="mt-2 w-full"
          disabled={loading}
          onClick={() => {
            actions.setError('')
            navigate('/auth/choose')
          }}
        >
          ← Back
        </Button>
      </CardContent>
    </Card>
  )
}
