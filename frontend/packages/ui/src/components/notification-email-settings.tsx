import {Loader2} from 'lucide-react'
import {useEffect, useState, type FormEvent} from 'react'
import {Button} from '../button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog'
import {Input} from './input'
import {Label} from './label'
import {Switch} from './switch'

/**
 * Shared, cross-platform per-account email-notification settings UI: a single
 * switch that subscribes `defaultEmail` (the vault/session email) when turned
 * on and removes the notification email when turned off. The subscribed
 * address is only shown when it differs from `defaultEmail` (e.g. it was set
 * from another app). When no `defaultEmail` is known (desktop with a local
 * identity), turning the switch on opens a dialog to enter the address instead.
 *
 * Presentational and backend-agnostic: each platform maps its own notification
 * state into these props and wires the callbacks to its own data layer (the web
 * vault signs requests to the notification server with the account key — and
 * registers the account inside its onSetEmail when needed; the desktop app
 * talks to the gateway notify-service over the daemon). `onResendVerification`
 * renders a resend button (desktop's notify-service).
 *
 * TODO(notifications): the two platforms still differ behind this UI. The goal is
 * full parity — desktop should adopt the web's seed-signed registration model,
 * which requires a daemon API to sign notification requests with the account key.
 */
export function NotificationEmailSettings({
  isNotifyServerConnected = true,
  loading = false,
  email,
  needsVerification,
  verificationMessage,
  statusMessage,
  error,
  defaultEmail = '',
  disabled = false,
  saving = false,
  removing = false,
  resending = false,
  onSetEmail,
  onRemoveEmail,
  onResendVerification,
}: {
  isNotifyServerConnected?: boolean
  /** True while the current status is still being fetched and is not yet known. */
  loading?: boolean
  email: string | null
  needsVerification: boolean
  verificationMessage?: string
  statusMessage?: string
  error?: string | null
  /** The email subscribed when the switch is turned on (the vault/session email). */
  defaultEmail?: string
  disabled?: boolean
  saving?: boolean
  removing?: boolean
  resending?: boolean
  onSetEmail?: (email: string) => void
  onRemoveEmail?: () => void
  onResendVerification?: () => void
}) {
  // Fallback for platforms with no known vault email: flipping the switch on
  // opens a dialog to type the address to subscribe.
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')

  const normalizedDefaultEmail = defaultEmail.trim()
  const subscribed = Boolean(email)

  // Once an email is subscribed (or the account switches), the dialog is done.
  useEffect(() => {
    setEmailDialogOpen(false)
  }, [email])

  const busy = loading || saving || removing
  const connectionFailed = !isNotifyServerConnected
  // Flip the switch optimistically while a save/remove is in flight.
  const checked = saving ? true : removing ? false : subscribed
  // While verification is pending, the address is shown inside the
  // verification callout instead of as a separate line.
  const showEmail =
    subscribed && !needsVerification && email!.trim().toLowerCase() !== normalizedDefaultEmail.toLowerCase()

  function handleCheckedChange(next: boolean) {
    if (next) {
      if (!onSetEmail) return
      if (normalizedDefaultEmail) {
        onSetEmail(normalizedDefaultEmail)
      } else {
        setEmailInput('')
        setEmailDialogOpen(true)
      }
    } else if (subscribed) {
      onRemoveEmail?.()
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next = emailInput.trim()
    if (!next || !onSetEmail) return
    onSetEmail(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {needsVerification ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p>
            Notifications will be sent to <span className="font-medium">{email}</span>.{' '}
            {verificationMessage ?? 'Check your inbox to verify this email address.'}
          </p>
          {onResendVerification ? (
            <div>
              <Button type="button" size="sm" variant="outline" disabled={resending} onClick={onResendVerification}>
                {resending ? 'Sending…' : 'Resend verification email'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="notification-email-switch" className="font-normal">
          Get notified for mentions and replies across all Hypermedia sites
        </Label>
        <Switch
          id="notification-email-switch"
          checked={checked}
          disabled={disabled || busy || connectionFailed || !onSetEmail}
          onCheckedChange={handleCheckedChange}
        />
      </div>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="w-full max-w-[400px]">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Email notifications</DialogTitle>
              <DialogDescription>
                Enter the email address that will receive notifications for this account.
              </DialogDescription>
            </DialogHeader>
            <Input
              type="email"
              placeholder="you@example.com"
              value={emailInput}
              disabled={disabled || saving}
              autoFocus
              onChange={(event) => setEmailInput(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setEmailDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || saving || !emailInput.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {showEmail ? (
        <p className="text-muted-foreground text-sm">
          Notifications are sent to <span className="font-medium">{email}</span>.
        </p>
      ) : null}

      {connectionFailed && !loading ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">You are not connected to the notification server.</p>
      ) : null}

      {statusMessage ? (
        <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          <p>{statusMessage}</p>
        </div>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  )
}
