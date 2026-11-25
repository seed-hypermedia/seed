import {NOTIFY_SERVICE_HOST, SITE_BASE_URL} from '@shm/shared/constants'
import {NOTIFY_API_PREFIX, normalizeNotifyServiceUrl, notifyServiceOrigin} from '@shm/shared/notify-url'

/**
 * The public origin that notification email links point at. Notify always lives on a site's
 * origin, so links go to that origin: the settings page is served by the web app at
 * `/hm/email-notifications`, and the email-link endpoints by notify at `/hm/api/notify/*`.
 */
export function getNotifyEmailOrigin(notifyServiceHost: string | null | undefined = NOTIFY_SERVICE_HOST): string {
  const base = normalizeNotifyServiceUrl(notifyServiceHost) ?? normalizeNotifyServiceUrl(SITE_BASE_URL)
  if (!base) throw new Error('Notify service host is not configured')
  return notifyServiceOrigin(base)
}

/** Web page where the email's owner manages their notification settings with their admin token. */
export function buildEmailSettingsUrl(origin: string, token: string) {
  return `${origin}/hm/email-notifications?token=${encodeURIComponent(token)}`
}

/**
 * One-click unsubscribe (RFC 8058 POST), for the List-Unsubscribe header only. Never put it in an email body: link
 * scanners prefetch body links with GET, and GET unsubscribes too.
 */
export function buildEmailUnsubscribeUrl(origin: string, token: string) {
  return `${origin}${NOTIFY_API_PREFIX}/unsubscribe?token=${encodeURIComponent(token)}`
}

/** Marks a notification read, then redirects to `redirectTo`. */
export function buildNotificationReadRedirectUrl(
  origin: string,
  input: {token: string; accountId: string; eventId: string; eventAtMs: number; redirectTo: string},
) {
  const params = new URLSearchParams({
    token: input.token,
    accountId: input.accountId,
    eventId: input.eventId,
    eventAtMs: String(input.eventAtMs),
    redirectTo: input.redirectTo,
  })
  return `${origin}${NOTIFY_API_PREFIX}/read-redirect?${params.toString()}`
}

/** Marks a notification email verified, then redirects to the settings page. */
export function buildNotificationEmailVerificationUrl(origin: string, token: string) {
  return `${origin}${NOTIFY_API_PREFIX}/verify-email?${new URLSearchParams({token}).toString()}`
}
