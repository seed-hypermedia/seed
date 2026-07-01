import type React from 'react'
import {useEffect, useState} from 'react'
import {Divider} from '@/frontend/components/Divider'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import * as navigation from '@/frontend/navigation'
import {PasswordInput} from '@/frontend/components/PasswordInput'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Sign in view for existing users.
 */
export function LoginView() {
  const {email, password, loading, error, passkeySupported, userHasPassword, userHasPasskey, vaultConnectionRequest} =
    useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  const hasPasskeyOption = passkeySupported && userHasPasskey
  const [showPasswordForm, setShowPasswordForm] = useState(false)

  // The master-password form is shown directly when there's no passkey to try,
  // and otherwise behind a fallback the user can reveal — or that appears
  // automatically when a passkey attempt fails.
  const passwordVisible = userHasPassword && (!hasPasskeyOption || showPasswordForm)

  useEffect(() => {
    if (error && userHasPassword) setShowPasswordForm(true)
  }, [error, userHasPassword])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    actions.handleLogin()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">
          {vaultConnectionRequest ? 'Connect your desktop app' : 'Welcome Back'}
        </CardTitle>
        <CardDescription className="text-center">
          {vaultConnectionRequest ? `Sign in to ${email} to continue connecting this vault.` : `Sign in to ${email}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ErrorMessage message={error} />

        {hasPasskeyOption && (
          <>
            <Button variant="secondary" onClick={actions.handlePasskeyLogin} loading={loading} className="w-full">
              🔑 Sign in with Passkey
            </Button>
            {userHasPassword && !passwordVisible && (
              <Button
                variant="ghost"
                className="mt-2 w-full"
                disabled={loading}
                onClick={() => setShowPasswordForm(true)}
              >
                Enter master password instead
              </Button>
            )}
            {passwordVisible && <Divider>or</Divider>}
          </>
        )}

        {passwordVisible && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="text" name="username" value={email} autoComplete="username" className="hidden" readOnly />
            <PasswordInput
              id="password"
              label="Master Password"
              value={password}
              onChange={actions.setPassword}
              autoComplete="current-password"
              autoFocus={!hasPasskeyOption || showPasswordForm}
            />

            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
          </form>
        )}

        <Button
          variant="ghost"
          className="mt-4 w-full"
          onClick={() => {
            actions.setEmail('')
            navigate('/')
          }}
        >
          ← Use different email
        </Button>
      </CardContent>
    </Card>
  )
}
