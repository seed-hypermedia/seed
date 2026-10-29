import {
  clearNotificationEmailVerificationForAccount,
  getAllNotifications,
  getNotificationConfig,
  getNotificationEmailVerificationForAccount,
  registerInboxAccount,
  getNotificationReadState,
  getNotificationsPage,
  recordNotificationReadAudit,
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

type NotificationActionAudit = {
  /** The key that signed the request: the account itself, or a delegated web/mobile session key. */
  signerUid: string
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

/** One audit row's worth of an action: enough to replay it by hand, without the client's event list. */
function summarizeReadAction(action: NotificationMutationAction): Record<string, unknown> {
  if (action.type === 'mark-event-unread') {
    return {
      type: action.type,
      eventId: action.eventId,
      eventAtMs: action.eventAtMs,
      otherLoadedEvents: action.otherLoadedEvents.length,
    }
  }
  const {type, ...rest} = action
  return {type, ...rest}
}

/**
 * Notifications that a read-state write turned from read to unread. Compaction and the read actions are meant to
 * be monotonic, so any count above zero is the trace of a bug (or of an unread toggle, which lists one event).
 */
export function findReadRegressions(
  before: NotificationReadLikeState,
  after: NotificationReadLikeState,
  notifications: NotificationPayload[],
): string[] {
  const regressed: Array<{eventId: string; eventAtMs: number}> = []
  for (const notification of notifications) {
    const input = {eventId: notification.feedEventId, eventAtMs: notification.eventAtMs}
    if (
      isNotificationEventRead({readState: before, ...input}) &&
      !isNotificationEventRead({readState: after, ...input})
    ) {
      regressed.push(input)
    }
  }
  return regressed.sort((left, right) => left.eventAtMs - right.eventAtMs).map((event) => event.eventId)
}

const READ_AUDIT_SAMPLE_SIZE = 5

/** Applies shared notification actions on the notify service and returns canonical state. */
export async function applyNotificationActionsForAccount(
  accountId: string,
  actions: NotificationMutationAction[],
  opts: NotificationStatePageOptions = {},
  audit?: NotificationActionAudit,
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

    const regressed = findReadRegressions(currentState.readState, nextState.readState, getAllAccountNotifications())
    const readActions = actions.filter(isReadStateMutation)
    recordNotificationReadAudit({
      at: Date.now(),
      accountId,
      signerUid: audit?.signerUid ?? null,
      siteUid: opts.siteUid ?? null,
      actions: readActions.map(summarizeReadAction),
      markBefore: currentState.readState.markAllReadAtMs,
      markAfter: nextState.readState.markAllReadAtMs,
      readEventsBefore: currentState.readState.readEvents.length,
      readEventsAfter: nextState.readState.readEvents.length,
      regressed: regressed.length,
      regressedSample: regressed.slice(0, READ_AUDIT_SAMPLE_SIZE),
    })
    // An unread toggle regresses exactly its one event. Anything more is the bug this audit exists to catch.
    const expectedRegressions = readActions.filter((action) => action.type === 'mark-event-unread').length
    if (regressed.length > expectedRegressions) {
      console.warn('[notify][read-state] read marks regressed', {
        accountId,
        signerUid: audit?.signerUid ?? null,
        siteUid: opts.siteUid ?? null,
        actions: readActions.map((action) => action.type),
        markBefore: currentState.readState.markAllReadAtMs,
        markAfter: nextState.readState.markAllReadAtMs,
        regressed: regressed.length,
        sample: regressed.slice(0, READ_AUDIT_SAMPLE_SIZE),
      })
    }
  }

  await persistNotificationConfigState(accountId, currentState.config, nextState.config)

  return getNotificationStateSnapshot(accountId, opts)
}
