import {getEmailWithToken, getNotificationConfig, getSubscription, mergeNotificationReadState} from './db'

export const EMAIL_NOTIFICATION_REDIRECT_PATH = '/hm/notification-read-redirect'

export function buildNotificationReadRedirectUrl(input: {
  notifyServiceHost: string
  token: string
  accountId: string
  eventId: string
  eventAtMs: number
  redirectTo: string
}) {
  const params = new URLSearchParams({
    token: input.token,
    accountId: input.accountId,
    eventId: input.eventId,
    eventAtMs: String(input.eventAtMs),
    redirectTo: input.redirectTo,
  })
  return `${input.notifyServiceHost.replace(/\/$/, '')}${EMAIL_NOTIFICATION_REDIRECT_PATH}?${params.toString()}`
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

export function applyNotificationReadFromEmailLink(input: {
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
  const isLinkedToAccount = Boolean(subscription) || notificationConfig?.email === email.email
  if (!isLinkedToAccount) {
    return {applied: false, reason: 'subscription-not-found' as const}
  }

  mergeNotificationReadState(input.accountId, {
    markAllReadAtMs: null,
    readEvents: [{eventId: input.eventId, eventAtMs: input.eventAtMs}],
  })

  return {
    applied: true,
    reason: 'ok' as const,
    email: email.email,
    accountId: input.accountId,
  }
}
