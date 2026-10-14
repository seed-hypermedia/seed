import {applyNotificationReadFromEmailLink, getSafeNotificationRedirectTarget} from '@/notification-read-redirect'
import {settingsPageRedirect} from '@/settings-redirect'

/**
 * Email link: marks the notification read, then redirects to `redirectTo` (only http/https URLs are
 * followed) or, failing that, to the email settings page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const nowMs = Date.now()
  const token = url.searchParams.get('token')
  const accountId = url.searchParams.get('accountId')
  const eventId = url.searchParams.get('eventId')
  const eventAtMs = Number(url.searchParams.get('eventAtMs'))
  const safeTarget = getSafeNotificationRedirectTarget(url.searchParams.get('redirectTo'))
  console.log('[notification-read-redirect] request received', {
    hasToken: Boolean(token),
    hasAccountId: Boolean(accountId),
    hasEventId: Boolean(eventId),
    eventAtMsValid: Number.isFinite(eventAtMs),
    hasRedirectTo: Boolean(url.searchParams.get('redirectTo')),
  })

  if (token && accountId && eventId && Number.isFinite(eventAtMs)) {
    try {
      const result = applyNotificationReadFromEmailLink({
        token,
        accountId,
        eventId,
        eventAtMs,
      })
      if (!result.applied) {
        console.warn('[notification-read-redirect] read-state not applied', {
          accountId,
          eventId,
          eventAtMs,
          eventAgeMs: Number.isFinite(eventAtMs) ? nowMs - eventAtMs : null,
          reason: result.reason,
          hasLegacySubscription: 'hasLegacySubscription' in result ? result.hasLegacySubscription : undefined,
          hasNotificationConfigLink:
            'hasNotificationConfigLink' in result ? result.hasNotificationConfigLink : undefined,
        })
      } else {
        console.info('[notification-read-redirect] read-state updated', {
          accountId,
          eventId,
          eventAtMs,
          eventAgeMs: nowMs - eventAtMs,
          linkType: result.linkType,
          stateUpdatedAtMs: result.stateUpdatedAtMs,
          markAllReadAtMs: result.markAllReadAtMs,
          redirectTo: safeTarget,
        })
      }
    } catch (error) {
      console.error('[notification-read-redirect] failed to apply read-state', {
        accountId,
        eventId,
        eventAtMs,
        eventAgeMs: Number.isFinite(eventAtMs) ? nowMs - eventAtMs : null,
        error,
      })
    }
  } else {
    console.warn('[notification-read-redirect] missing query fields', {
      hasToken: Boolean(token),
      hasAccountId: Boolean(accountId),
      hasEventId: Boolean(eventId),
      eventAtMsRaw: url.searchParams.get('eventAtMs'),
    })
  }

  if (safeTarget) {
    return Response.redirect(safeTarget, 302)
  }

  return settingsPageRedirect({token})
}
