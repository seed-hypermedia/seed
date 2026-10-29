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
import {
  reduceNotificationState,
  type NotificationConfigState,
  type NotificationMutationAction,
  type NotificationStateSnapshot,
} from '@shm/shared/models/notification-state'
import {
  isNotificationEventRead,
  markNotificationsReadInState,
  notificationMatchesSite,
  type NotificationReadLikeState,
} from '@shm/shared/models/notification-read-logic'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'

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
  const verificationUrl = buildNotificationEmailVerificationUrl({token})
  const verificationEmail = await createNotificationVerificationEmail({
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

/**
 * Resolves a client's unread toggle against every notification the service holds.
 *
 * Marking an event unread below the watermark lowers the watermark, and the shared reducer re-lists the events
 * between as explicit reads. Clients only know the page they loaded (the web app loads one space), so a toggle
 * built from their list would silently flip every other notification in that span to unread. The service has the
 * whole inbox, so it supplies the list, and the toggle only affects the one event.
 */
function resolveUnreadAction(
  action: Extract<NotificationMutationAction, {type: 'mark-event-unread'}>,
  allNotifications: NotificationPayload[],
): Extract<NotificationMutationAction, {type: 'mark-event-unread'}> {
  const target = allNotifications.find((notification) => notification.feedEventId === action.eventId)
  return {
    type: 'mark-event-unread',
    eventId: action.eventId,
    // The service's time for the event wins, so the lowered watermark lands just before it.
    eventAtMs: target?.eventAtMs ?? action.eventAtMs,
    otherLoadedEvents: allNotifications.map((notification) => ({
      eventId: notification.feedEventId,
      eventAtMs: notification.eventAtMs,
    })),
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

  // Every read mutation resolves against the whole inbox, so load it once per request.
  let allNotifications: NotificationPayload[] | null = null
  const getAllAccountNotifications = () => {
    if (!allNotifications) allNotifications = getAllNotifications(accountId)
    return allNotifications
  }

  for (const action of actions) {
    if (action.type === 'mark-site-read') {
      nextState = {
        ...nextState,
        readState: markNotificationsReadInState(
          nextState.readState,
          getAllAccountNotifications().filter((notification) => notificationMatchesSite(notification, action.siteUid)),
        ),
      }
      hasReadStateChanges = true
      continue
    }

    if (action.type === 'mark-event-unread') {
      nextState = reduceNotificationState(nextState, resolveUnreadAction(action, getAllAccountNotifications()))
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
        ...compactNotificationReadState(nextState.readState, getAllAccountNotifications()),
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
