import {applyNotificationReadFromEmailLink, getSafeNotificationRedirectTarget} from '@/notification-read-redirect'
import {LoaderFunction, redirect} from '@remix-run/node'

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  const accountId = url.searchParams.get('accountId')
  const eventId = url.searchParams.get('eventId')
  const eventAtMs = Number(url.searchParams.get('eventAtMs'))
  const safeTarget = getSafeNotificationRedirectTarget(url.searchParams.get('redirectTo'))

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
          reason: result.reason,
        })
      } else {
        console.info('[notification-read-redirect] read-state updated', {
          accountId,
          eventId,
        })
      }
    } catch (error) {
      console.error('[notification-read-redirect] failed to apply read-state', {
        accountId,
        eventId,
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
    return redirect(safeTarget)
  }

  if (token) {
    return redirect(`/hm/email-notifications?token=${encodeURIComponent(token)}`)
  }

  return redirect('/hm/email-notifications')
}
