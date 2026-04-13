import {
  clearNotificationEmailVerificationForAccount,
  getAllNotifications,
  getNotificationConfig,
  getNotificationEmailVerificationForAccount,
  registerInboxAccount,
  getNotificationReadState,
  getNotificationsPage,
  removeNotificationConfig,
  replaceNotificationReadState,
  setNotificationConfig,
  setNotificationEmailVerification,
} from './db'
import {sendEmail} from './mailer'
import {
  buildNotificationEmailVerificationUrl,
  isNotificationEmailVerificationExpired,
} from './notification-email-verification'
import {createNotificationVerificationEmail} from '@shm/emails/notifier'
import {NOTIFY_SERVICE_HOST, SITE_BASE_URL} from '@shm/shared/constants'
import {
  reduceNotificationState,
  type NotificationConfigState,
  type NotificationMutationAction,
  type NotificationStateSnapshot,
} from '@shm/shared/models/notification-state'
import {
  isNotificationEventRead,
  markNotificationEventReadInState,
  type NotificationReadLikeState,
} from '@shm/shared/models/notification-read-logic'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'

const notificationEmailHost = (NOTIFY_SERVICE_HOST || SITE_BASE_URL).replace(/\/$/, '')

type NotificationStatePageOptions = {
  beforeMs?: number
  limit?: number
  siteUid?: string
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getNotificationConfigState(accountId: string): NotificationConfigState {
  const config = getNotificationConfig(accountId)
  const verification = config ? getNotificationEmailVerificationForAccount(accountId) : null
  const activeVerification =
    !config?.verifiedTime && verification && config && verification.email === config.email ? verification : null
  const verificationSendTime = activeVerification?.sendTime ?? null
  const verificationExpired = verificationSendTime
    ? isNotificationEmailVerificationExpired(verificationSendTime)
    : false
  return {
    accountId,
    email: config?.email ?? null,
    verifiedTime: config?.verifiedTime ?? null,
    verificationSendTime,
    verificationExpired,
  }
}

async function sendNotificationVerificationEmail(email: string, token: string) {
  if (!notificationEmailHost) {
    throw new Error('Notify service host is not configured')
  }
  const verificationUrl = buildNotificationEmailVerificationUrl({
    notifyServiceHost: notificationEmailHost,
    token,
  })
  const verificationEmail = createNotificationVerificationEmail({
    verificationUrl,
  })
  await sendEmail(email, verificationEmail.subject, {
    text: verificationEmail.text,
    html: verificationEmail.html,
  })
}

async function persistNotificationConfigState(
  accountId: string,
  currentConfig: NotificationConfigState,
  nextConfig: NotificationConfigState,
) {
  if (!nextConfig.email) {
    removeNotificationConfig(accountId)
    clearNotificationEmailVerificationForAccount(accountId)
    return
  }

  const normalizedEmail = normalizeEmail(nextConfig.email)
  setNotificationConfig(accountId, normalizedEmail)

  if (nextConfig.verifiedTime) {
    clearNotificationEmailVerificationForAccount(accountId)
    return
  }

  if (!nextConfig.verificationSendTime) {
    clearNotificationEmailVerificationForAccount(accountId)
    return
  }

  const currentVerification = getNotificationEmailVerificationForAccount(accountId)
  const shouldSendVerification =
    currentConfig.email !== normalizedEmail ||
    currentConfig.verificationSendTime !== nextConfig.verificationSendTime ||
    currentVerification?.email !== normalizedEmail ||
    currentVerification?.sendTime !== nextConfig.verificationSendTime

  setNotificationEmailVerification({
    accountId,
    email: normalizedEmail,
    sendTime: nextConfig.verificationSendTime,
  })

  if (shouldSendVerification) {
    const verification = getNotificationEmailVerificationForAccount(accountId)
    if (!verification) {
      throw new Error('Failed to save notification email verification')
    }
    await sendNotificationVerificationEmail(normalizedEmail, verification.token)
  }
}

function isReadStateMutation(action: NotificationMutationAction) {
  return (
    action.type === 'mark-event-read' ||
    action.type === 'mark-event-unread' ||
    action.type === 'mark-all-read' ||
    action.type === 'mark-site-read'
  )
}

function markSiteNotificationsRead(
  readState: NotificationStateSnapshot['readState'],
  notifications: NotificationPayload[],
): NotificationStateSnapshot['readState'] {
  let nextReadState = readState

  for (const notification of notifications) {
    if (
      isNotificationEventRead({
        readState: nextReadState,
        eventId: notification.feedEventId,
        eventAtMs: notification.eventAtMs,
      })
    ) {
      continue
    }

    nextReadState = {
      ...nextReadState,
      ...markNotificationEventReadInState({
        readState: nextReadState,
        eventId: notification.feedEventId,
        eventAtMs: notification.eventAtMs,
      }),
    }
  }

  return nextReadState
}

function compactNotificationReadState(
  readState: NotificationStateSnapshot['readState'],
  notifications: NotificationPayload[],
): NotificationReadLikeState {
  let nextMarkAllReadAtMs = readState.markAllReadAtMs
  const notificationBuckets = new Map<number, NotificationPayload[]>()

  for (const notification of notifications) {
    const bucket = notificationBuckets.get(notification.eventAtMs)
    if (bucket) {
      bucket.push(notification)
    } else {
      notificationBuckets.set(notification.eventAtMs, [notification])
    }
  }

  const sortedEventTimes = [...notificationBuckets.keys()].sort((left, right) => left - right)
  for (const eventAtMs of sortedEventTimes) {
    if (nextMarkAllReadAtMs !== null && eventAtMs <= nextMarkAllReadAtMs) continue
    const bucket = notificationBuckets.get(eventAtMs) ?? []
    const bucketHasUnread = bucket.some(
      (notification) =>
        !isNotificationEventRead({
          readState,
          eventId: notification.feedEventId,
          eventAtMs: notification.eventAtMs,
        }),
    )
    if (bucketHasUnread) break
    nextMarkAllReadAtMs = eventAtMs
  }

  return {
    markAllReadAtMs: nextMarkAllReadAtMs,
    readEvents: readState.readEvents.filter(
      (readEvent) => nextMarkAllReadAtMs === null || readEvent.eventAtMs > nextMarkAllReadAtMs,
    ),
  }
}

/** Returns the canonical notification state snapshot for an account. */
export function getNotificationStateSnapshot(
  accountId: string,
  opts: NotificationStatePageOptions = {},
): NotificationStateSnapshot {
  registerInboxAccount(accountId)
  const inbox = getNotificationsPage(accountId, opts)
  return {
    accountId,
    inbox,
    config: getNotificationConfigState(accountId),
    readState: getNotificationReadState(accountId),
  }
}

/** Applies shared notification actions on the notify service and returns canonical state. */
export async function applyNotificationActionsForAccount(
  accountId: string,
  actions: NotificationMutationAction[],
  opts: NotificationStatePageOptions = {},
): Promise<NotificationStateSnapshot> {
  if (!actions.length) {
    return getNotificationStateSnapshot(accountId, opts)
  }

  const currentState = getNotificationStateSnapshot(accountId, opts)
  let nextState = currentState
  let hasReadStateChanges = false

  for (const action of actions) {
    if (action.type === 'mark-site-read') {
      nextState = {
        ...nextState,
        readState: markSiteNotificationsRead(
          nextState.readState,
          getAllNotifications(accountId, {siteUid: action.siteUid}),
        ),
      }
      hasReadStateChanges = true
      continue
    }

    nextState = reduceNotificationState(nextState, action)
    hasReadStateChanges = hasReadStateChanges || isReadStateMutation(action)
  }

  if (hasReadStateChanges) {
    nextState = {
      ...nextState,
      readState: {
        ...nextState.readState,
        ...compactNotificationReadState(nextState.readState, getAllNotifications(accountId)),
      },
    }
    replaceNotificationReadState(accountId, {
      markAllReadAtMs: nextState.readState.markAllReadAtMs,
      readEvents: nextState.readState.readEvents,
    })
  }

  await persistNotificationConfigState(accountId, currentState.config, nextState.config)

  return getNotificationStateSnapshot(accountId, opts)
}
