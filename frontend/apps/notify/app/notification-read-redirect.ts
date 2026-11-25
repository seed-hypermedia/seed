import {getEmailWithToken, getNotificationConfig, getNotificationReadState, getSubscription} from './db'
import {applyNotificationActionsForAccount} from './notification-state'
import {buildNotificationReadRedirectUrl as buildReadRedirectUrl, getNotifyEmailOrigin} from '@shm/emails/notify-links'

/** Email link that marks a notification read and then redirects to `redirectTo` (`/hm/api/notify/read-redirect`). */
export function buildNotificationReadRedirectUrl(input: {
  notifyServiceHost?: string
  token: string
  accountId: string
  eventId: string
  eventAtMs: number
  redirectTo: string
}) {
  const {notifyServiceHost, ...params} = input
  return buildReadRedirectUrl(getNotifyEmailOrigin(notifyServiceHost), params)
}

export function getSafeNotificationRedirectTarget(redirectTo: string | null): string | null {
  if (!redirectTo) return null
  try {
    const parsed = new URL(redirectTo)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * Marks one notification read from an email link. It goes through the same actions path as the apps, so every
 * other read mark of the account is kept: a snapshot merge here would replace them all with this one event.
 */
export async function applyNotificationReadFromEmailLink(input: {
  token: string
  accountId: string
  eventId: string
  eventAtMs: number
}) {
  if (!Number.isFinite(input.eventAtMs) || input.eventAtMs <= 0) {
    return {applied: false, reason: 'invalid-event-time' as const}
  }

  const email = getEmailWithToken(input.token)
  if (!email) {
    return {applied: false, reason: 'invalid-token' as const}
  }

  const subscription = getSubscription(input.accountId, email.email)
  const notificationConfig = getNotificationConfig(input.accountId)
  const hasLegacySubscription = Boolean(subscription)
  const hasNotificationConfigLink = notificationConfig?.email === email.email
  const isLinkedToAccount = hasLegacySubscription || hasNotificationConfigLink
  if (!isLinkedToAccount) {
    return {
      applied: false,
      reason: 'subscription-not-found' as const,
      hasLegacySubscription,
      hasNotificationConfigLink,
    }
  }

  await applyNotificationActionsForAccount(input.accountId, [
    {type: 'mark-event-read', eventId: input.eventId, eventAtMs: input.eventAtMs},
  ])
  const mergedReadState = getNotificationReadState(input.accountId)

  return {
    applied: true,
    reason: 'ok' as const,
    email: email.email,
    accountId: input.accountId,
    linkType: hasLegacySubscription ? ('legacy-subscription' as const) : ('notification-config' as const),
    stateUpdatedAtMs: mergedReadState.stateUpdatedAtMs,
    markAllReadAtMs: mergedReadState.markAllReadAtMs,
  }
}
