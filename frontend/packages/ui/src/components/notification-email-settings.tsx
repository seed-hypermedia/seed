import { Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../button'
import { SizableText } from '../text'
import { Input } from './input'

/**
 * Shared, cross-platform per-account email-notification settings UI.
 *
 * Presentational and backend-agnostic: each platform maps its own notification
 * state into these props and wires the callbacks to its own data layer (the web
 * vault signs requests to the notification server with the account key; the
 * desktop app talks to the gateway notify-service over the daemon). Capabilities
 * that only one platform currently supports are optional:
 *
 * - `onRegister` renders a "Register account" step (web's seed-signed model).
 * - `onResendVerification` renders a resend button (desktop's notify-service).
 *
 * TODO(notifications): the two platforms still differ behind this UI. The goal is
 * full parity — desktop should adopt the web's seed-signed registration model,
 * which requires a daemon API to sign notification requests with the account key.
 */
export function NotificationEmailSettings({
  serverLabel,
  isRegistered,
  isNotifyServerConnected = true,
  email,
  isVerified,
  needsVerification,
  verificationMessage,
  statusMessage,
  error,
  defaultEmail = '',
  disabled = false,
  saving = false,
  removing = false,
  registering = false,
  resending = false,
  onRegister,
  onSetEmail,
  onRemoveEmail,
  onResendVerification,
}: {
  /** Human-readable notify server (e.g. "notify.seed.hyper.media"), or null if none is configured. */
  serverLabel: string | null
  isRegistered: boolean
  isNotifyServerConnected?: boolean
  email: string | null
  isVerified: boolean
  needsVerification: boolean
  verificationMessage?: string
  statusMessage?: string
  error?: string | null
  /** Prefill for the email input (the web vault passes the session email). */
  defaultEmail?: string
  disabled?: boolean
  saving?: boolean
  removing?: boolean
  registering?: boolean
  resending?: boolean
  onRegister?: () => void
  onSetEmail?: (email: string) => void
  onRemoveEmail?: () => void
  onResendVerification?: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [emailInput, setEmailInput] = useState(defaultEmail)

  // Keep the input seeded with the latest current/default email when not editing.
  useEffect(() => {
    if (!isEditing) setEmailInput(email ?? defaultEmail)
  }, [email, defaultEmail, isEditing])

  const hasServer = Boolean(serverLabel)
  const showRegister = hasServer && !isRegistered && !registering && Boolean(onRegister)
  const showEmailRow = hasServer && isRegistered && Boolean(email) && !isEditing
  const showEmailForm = hasServer && isRegistered && Boolean(onSetEmail) && (!email || isEditing)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next = emailInput.trim()
    if (!next || !onSetEmail) return
    onSetEmail(next)
    setIsEditing(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-col gap-2">
        <SizableText weight="bold">Email notifications</SizableText>
        <SizableText size="sm" color="muted">
          {!hasServer
            ? 'Configure a notification server in vault settings before registering this account.'
            : registering
              ? `Registering this account with ${serverLabel}.`
              : !isRegistered
                ? `Register this account to receive notifications from ${serverLabel}.`
                : 'Receive an email when there is activity involving this account.'}
        </SizableText>
      </div>

      {hasServer && !isNotifyServerConnected ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          You are not connected to the notification server.
        </div>
      ) : null}

      {statusMessage ? (
        <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          <p>{statusMessage}</p>
        </div>
      ) : null}

      {needsVerification ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p>{verificationMessage ?? 'Notification emails are paused until you verify this email address.'}</p>
          {onResendVerification ? (
            <div className="mt-2">
              <Button type="button" size="sm" variant="outline" disabled={resending} onClick={onResendVerification}>
                {resending ? 'Sending…' : 'Resend verification email'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showRegister ? (
        <Button variant="secondary" size="sm" onClick={onRegister} disabled={disabled || registering}>
          Register account
        </Button>
      ) : null}

      {showEmailRow ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex flex-col gap-1">
            <SizableText size="sm" weight="bold" className="truncate">
              {email}
            </SizableText>
            <SizableText size="xs" color="muted">
              {isVerified ? 'Verified' : 'Verification pending'}
            </SizableText>
          </div>
          <div className="flex flex-wrap gap-2">
            {onSetEmail ? (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setEmailInput(email ?? '')
                  setIsEditing(true)
                }}
              >
                Edit Email
              </Button>
            ) : null}
            {onRemoveEmail ? (
              <Button variant="outline" size="sm" disabled={disabled || removing} onClick={onRemoveEmail}>
                {removing ? 'Removing…' : 'Remove Email'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showEmailForm ? (
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <Input
            type="email"
            placeholder="you@example.com"
            value={emailInput}
            disabled={disabled || saving}
            onChange={(event) => setEmailInput(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            {email ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEmailInput(email)
                  setIsEditing(false)
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button type="submit" disabled={disabled || saving || !emailInput.trim()}>
              {saving ? 'Saving…' : email ? 'Save Email' : 'Set Email'}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  )
}
