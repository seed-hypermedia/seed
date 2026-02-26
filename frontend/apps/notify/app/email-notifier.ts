import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {createDesktopNotificationsEmail, createNotificationsEmail, Notification} from '@shm/emails/notifier'
import {
  createWebHMUrl,
  entityQueryPathToHmIdPath,
  Event,
  getAnnotations,
  HMBlockNode,
  HMComment,
  HMCommentSchema,
  HMDocument,
  hmId,
  HMMetadata,
  normalizeDate,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {DAEMON_HTTP_URL, NOTIFY_SERVICE_HOST, SITE_BASE_URL} from '@shm/shared/constants'
import {
  classifyCommentNotificationForAccount,
  extractMentionedAccountUidsFromComment,
} from '@shm/shared/models/notification-event-classifier'
import {CID} from 'multiformats'
import {
  getAllEmails,
  getAllNotificationConfigs,
  getBatchNotifierLastProcessedEventId,
  getBatchNotifierLastSendTime,
  getNotifierLastProcessedEventId,
  setBatchNotifierLastProcessedEventId,
  setBatchNotifierLastSendTime,
  setNotifierLastProcessedEventId,
} from './db'
import {sendEmail} from './mailer'
import {buildNotificationReadRedirectUrl} from './notification-read-redirect'
import {grpcClient, requestAPI} from './notify-request'

async function getDocument(id: UnpackedHypermediaId) {
  const resource = await requestAPI('Resource', id)
  if (resource.type !== 'document') {
    throw new Error(`Expected document resource, got ${resource.type}`)
  }
  return resource.document
}

// Track if notification processing is actually running (survives timeout)
let isNotifProcessingActive = false
let isBatchNotifProcessingActive = false

// Abort controllers for cancelling ongoing work
let currentNotifAbortController: AbortController | null = null
let currentBatchAbortController: AbortController | null = null

const isProd = process.env.NODE_ENV === 'production'

const emailBatchNotifIntervalHours = isProd ? 4 : 0.1 // 6 minute batching for dev

const handleImmediateEmailNotificationsIntervalSeconds = 15

type NotifReason = Notification['reason']
type NotificationDeliveryKind = 'immediate' | 'batch'

const adminEmail = process.env.SEED_DEV_ADMIN_EMAIL || 'eric@seedhypermedia.com'
const notificationEmailHost = (NOTIFY_SERVICE_HOST || SITE_BASE_URL).replace(/\/$/, '')
const notifDebugEnabled = process.env.NOTIFY_DEBUG === '1' || process.env.NODE_ENV !== 'production'

// Error batching for reportError
const errorBatchDelayMs = 30_000 // 30 seconds
let pendingErrors: string[] = []
let errorBatchTimeout: ReturnType<typeof setTimeout> | null = null

type NotificationEventMeta = {
  eventId?: string
  eventAtMs: number
}

type NotificationSubscription = {
  id: string
  email: string
  createdAt: string
  notifyAllMentions: boolean
  notifyAllReplies: boolean
  notifyOwnedDocChange: boolean
  notifySiteDiscussions: boolean
}

type QueuedNotification = {
  accountId: string
  accountMeta: HMMetadata | null
  adminToken: string
  notif: Notification
}

type NotificationsByEmail = Record<string, QueuedNotification[]>

type EmailIdentity = {
  adminToken: string
  isUnsubscribed: boolean
}

function logNotifDebug(message: string, details?: Record<string, unknown>) {
  if (!notifDebugEnabled) return
  if (details) {
    console.info(`[notify][email] ${message}`, details)
  } else {
    console.info(`[notify][email] ${message}`)
  }
}

function getActionUrlLogDetails(actionUrl: string) {
  try {
    const parsed = new URL(actionUrl)
    return {
      actionUrlHost: parsed.host,
      actionUrlPath: parsed.pathname,
      hasTokenParam: parsed.searchParams.has('token'),
      hasAccountIdParam: parsed.searchParams.has('accountId'),
      hasEventIdParam: parsed.searchParams.has('eventId'),
      hasEventAtMsParam: parsed.searchParams.has('eventAtMs'),
      hasRedirectToParam: parsed.searchParams.has('redirectTo'),
    }
  } catch {
    return {actionUrlParseError: true}
  }
}

function reportError(message: string) {
  const messageWithTime = `${new Date().toISOString()} ${message}`
  console.error(messageWithTime)
  pendingErrors.push(messageWithTime)

  if (!errorBatchTimeout) {
    errorBatchTimeout = setTimeout(flushErrorBatch, errorBatchDelayMs)
  }
}

const reportedOldEventIds = new Set<string>()

async function flushErrorBatch() {
  errorBatchTimeout = null
  if (pendingErrors.length === 0) return

  const errors = pendingErrors
  pendingErrors = []

  const subject =
    errors.length === 1 ? 'Email Notifier Error Report' : `Email Notifier Error Report (${errors.length} errors)`
  const text = errors.join('\n\n---\n\n')

  try {
    await sendEmail(adminEmail, subject, {text})
  } catch (err) {
    console.error('Failed to send error report email:', err)
  }
}

export async function initEmailNotifier() {
  console.log('Init Email Notifier')

  // Initial run
  try {
    isNotifProcessingActive = true
    currentNotifAbortController = new AbortController()
    await handleEmailNotifications(currentNotifAbortController.signal)
  } catch (err) {
    // Ignore initial errors
  } finally {
    isNotifProcessingActive = false
    currentNotifAbortController = null
  }

  setInterval(() => {
    // Use the active flag, not the promise - this survives timeouts
    if (isNotifProcessingActive) {
      console.log('Email notifications still processing. Skipping round.')
      return
    }

    const timeoutMs = 60_000 // 60 seconds max
    isNotifProcessingActive = true
    currentNotifAbortController = new AbortController()
    const signal = currentNotifAbortController.signal

    const processingPromise = handleEmailNotifications(signal)

    // Set up timeout to abort the work
    const timeoutId = setTimeout(() => {
      currentNotifAbortController?.abort()
      reportError(`Email notification processing timed out after ${timeoutMs}ms`)
    }, timeoutMs)

    // Wait for the actual promise to settle (not just the timeout race)
    processingPromise
      .catch((err: Error) => {
        // Don't report abort errors - they're expected after timeout
        if (err.message !== 'Event loading aborted') {
          reportError('Error handling email notifications: ' + err.message)
        }
      })
      .finally(() => {
        clearTimeout(timeoutId)
        isNotifProcessingActive = false
        currentNotifAbortController = null
      })
  }, 1000 * handleImmediateEmailNotificationsIntervalSeconds)

  setInterval(() => {
    if (isBatchNotifProcessingActive) return

    const timeoutMs = 120_000 // 120 seconds max for batch processing
    isBatchNotifProcessingActive = true
    currentBatchAbortController = new AbortController()
    const signal = currentBatchAbortController.signal

    const processingPromise = handleBatchNotifications(signal)

    // Set up timeout to abort the work
    const timeoutId = setTimeout(() => {
      currentBatchAbortController?.abort()
      reportError(`Batch notification processing timed out after ${timeoutMs}ms`)
    }, timeoutMs)

    // Wait for the actual promise to settle (not just the timeout race)
    processingPromise
      .catch((err: Error) => {
        // Don't report abort errors - they're expected after timeout
        if (err.message !== 'Event loading aborted') {
          reportError('Error handling batch email notifications: ' + err.message)
        }
      })
      .finally(() => {
        clearTimeout(timeoutId)
        isBatchNotifProcessingActive = false
        currentBatchAbortController = null
      })
  }, 30_000)
}

async function handleBatchNotifications(signal?: AbortSignal) {
  const lastSendTime = getBatchNotifierLastSendTime()
  const lastProcessedEventId = getBatchNotifierLastProcessedEventId()
  const lastEventId = await getLastEventId()
  if (!lastEventId) {
    reportError('No last event ID found. Verify connection to the daemon and make sure the activity api has events.')
    return
  }
  if (!lastSendTime || !lastProcessedEventId) {
    const resetTime = new Date()
    // we refuse to send all notifications for the whole historical feed. so if we haven't sent any notifications yet, we will do so after the first interval elapses
    reportError(
      'Batch notifier missing cursor values. Setting initial: ' +
        JSON.stringify({
          resetTime: resetTime.toISOString(),
          lastEventId,
        }),
    )
    setBatchNotifierLastSendTime(resetTime)
    setBatchNotifierLastProcessedEventId(lastEventId)
    return
  }
  const nowTime = Date.now()
  const nextSendTime = lastSendTime.getTime() + emailBatchNotifIntervalHours * 60 * 60 * 1000
  if (nextSendTime < nowTime) {
    try {
      await sendBatchNotifications(lastProcessedEventId, signal)
    } catch (error: any) {
      reportError('Error sending batch notifications: ' + error.message)
    } finally {
      // even if there is an error, we still want to mark the events as processed.
      // so that we don't attempt to process the same events again.
      setBatchNotifierLastSendTime(new Date())
      setBatchNotifierLastProcessedEventId(lastEventId)
    }
  } else {
    console.log(`Next batch notifications will send in ${Math.round((nextSendTime - nowTime) / 1000)} seconds`)
  }
}

async function handleEmailNotifications(signal?: AbortSignal) {
  const startTime = Date.now()
  const lastProcessedEventId = getNotifierLastProcessedEventId()
  // logNotifDebug('immediate loop tick', {
  //   hasCursor: Boolean(lastProcessedEventId),
  //   lastProcessedEventId,
  // })
  if (lastProcessedEventId) {
    await handleImmediateNotificationsAfterEventId(lastProcessedEventId, signal)
    const elapsed = Date.now() - startTime
    if (elapsed > 10_000) {
      console.warn(`handleEmailNotifications took ${elapsed}ms`)
    }
  } else {
    reportError('No last processed event ID found. Resetting last processed event ID')
    await resetNotifierLastProcessedEventId()
  }
}

async function getLastEventId(): Promise<string | undefined> {
  const {events} = await grpcClient.activityFeed.listEvents({
    pageToken: undefined,
    pageSize: 5,
  })
  const event = events.at(0)
  if (!event) return
  const plainEvent =
    typeof (event as any).toJson === 'function' ? toPlainMessage(event) : (event as PlainMessage<Event>)
  const lastEventId = getEventId(plainEvent)
  if (!lastEventId) return
  return lastEventId
}

async function sendBatchNotifications(lastProcessedEventId: string, signal?: AbortSignal) {
  console.log('Sending batch notifications', lastProcessedEventId)
  const {events, foundCursor, aborted} = await loadEventsAfterEventId(lastProcessedEventId, signal)
  console.log('Batch notifications events to process:', events.length)
  if (!foundCursor && !aborted) {
    // Cursor not found and not aborted - something is wrong with the feed
    console.warn('Batch: cursor not found in feed, processing available events')
  }
  if (events.length === 0) return
  await processBatchNotifications(events)
}

async function resetNotifierLastProcessedEventId() {
  const lastEventId = await getLastEventId()
  if (!lastEventId) return
  reportError('Resetting notifier last processed event ID to ' + lastEventId)
  setNotifierLastProcessedEventId(lastEventId)
}

async function handleImmediateNotificationsAfterEventId(lastProcessedEventId: string, signal?: AbortSignal) {
  const startTime = Date.now()

  const {events, foundCursor, aborted} = await loadEventsAfterEventId(lastProcessedEventId, signal)

  const loadTime = Date.now() - startTime
  if (loadTime > 5000) {
    console.warn(`loadEventsAfterEventId took ${loadTime}ms for ${events.length} events`)
  }

  if (!foundCursor && !aborted && events.length > 0) {
    // Cursor not found but we have events - something is wrong
    // Still process events but log warning
    console.warn('Immediate: cursor not found in feed, processing available events')
  }

  if (events.length === 0) return

  const processStartTime = Date.now()
  try {
    await processImmediateNotifications(events)
  } catch (error: any) {
    reportError('Error handling immediate notifications: ' + error.message)
  } finally {
    // even if there is an error, we still want to mark the events as processed.
    // so that we don't attempt to process the same events again.
    markEventsAsProcessed(events)

    const processTime = Date.now() - processStartTime
    if (processTime > 5000) {
      console.warn(`processImmediateNotifications took ${processTime}ms for ${events.length} events`)
    }
  }
}

function buildEmailIdentityMap(allEmails: ReturnType<typeof getAllEmails>): Map<string, EmailIdentity> {
  const emailIdentityMap = new Map<string, EmailIdentity>()
  for (const email of allEmails) {
    emailIdentityMap.set(email.email, {
      adminToken: email.adminToken,
      isUnsubscribed: email.isUnsubscribed,
    })
  }
  return emailIdentityMap
}

function getImmediateSubscriptions(emailIdentityMap: Map<string, EmailIdentity>): NotificationSubscription[] {
  return getAllNotificationConfigs()
    .filter((config) => {
      const identity = emailIdentityMap.get(config.email)
      return Boolean(identity && !identity.isUnsubscribed)
    })
    .map((config) => ({
      id: config.accountId,
      email: config.email,
      createdAt: config.createdAt,
      notifyAllMentions: true,
      notifyAllReplies: true,
      notifyOwnedDocChange: false,
      notifySiteDiscussions: false,
    }))
}

function getBatchSubscriptions(
  allEmails: ReturnType<typeof getAllEmails>,
  emailIdentityMap: Map<string, EmailIdentity>,
): NotificationSubscription[] {
  const subscriptions: NotificationSubscription[] = []
  for (const email of allEmails) {
    const identity = emailIdentityMap.get(email.email)
    if (!identity || identity.isUnsubscribed) continue
    for (const subscription of email.subscriptions) {
      subscriptions.push({
        ...subscription,
        notifyAllMentions: false,
        notifyAllReplies: false,
      })
    }
  }
  return subscriptions
}

function getNotificationDeliveryKind(reason: NotifReason): NotificationDeliveryKind | null {
  if (reason === 'mention' || reason === 'reply') return 'immediate'
  if (reason === 'site-doc-update' || reason === 'site-new-discussion') return 'batch'
  return null
}

async function collectNotificationsForEvents({
  events,
  subscriptions,
  deliveryKind,
  emailIdentityMap,
}: {
  events: PlainMessage<Event>[]
  subscriptions: NotificationSubscription[]
  deliveryKind: NotificationDeliveryKind
  emailIdentityMap: Map<string, EmailIdentity>
}): Promise<NotificationsByEmail> {
  const notificationsToSend: NotificationsByEmail = {}
  if (!events.length || !subscriptions.length) return notificationsToSend

  const mentionSourceBlobCids = new Set<string>()
  for (const event of events) {
    if (event.data.case !== 'newMention') continue
    const sourceBlobCid = event.data.value?.sourceBlob?.cid
    if (sourceBlobCid) mentionSourceBlobCids.add(sourceBlobCid)
  }

  logNotifDebug('notification evaluation start', {
    eventCount: events.length,
    deliveryKind,
    subscriptions: subscriptions.length,
  })

  async function appendNotification(subscription: NotificationSubscription, notif: Notification) {
    const identity = emailIdentityMap.get(subscription.email)
    if (!identity || identity.isUnsubscribed) return
    if (getNotificationDeliveryKind(notif.reason) !== deliveryKind) return
    notificationsToSend[subscription.email] = notificationsToSend[subscription.email] ?? []
    notificationsToSend[subscription.email]!.push({
      accountId: subscription.id,
      adminToken: identity.adminToken,
      accountMeta: null,
      notif,
    })
  }

  for (const event of events) {
    const eventStartTime = Date.now()
    const eventId = getEventId(event)
    const notificationCountBefore = Object.values(notificationsToSend).reduce((count, items) => count + items.length, 0)
    try {
      await evaluateEventForNotifications(event, subscriptions, appendNotification, {mentionSourceBlobCids})
    } catch (error: any) {
      reportError('Error evaluating event for notifications: ' + error.message)
    }
    const notificationCountAfter = Object.values(notificationsToSend).reduce((count, items) => count + items.length, 0)
    logNotifDebug('event notification result', {
      eventId,
      newNotificationsQueued: notificationCountAfter - notificationCountBefore,
      totalQueued: notificationCountAfter,
    })
    const eventTime = Date.now() - eventStartTime
    if (eventTime > 5000) {
      reportError(`Slow event processing: ${eventId} took ${eventTime}ms (threshold: 5000ms)`)
    }
  }

  return notificationsToSend
}

function withImmediateActionUrl(notification: QueuedNotification): QueuedNotification {
  if (notification.notif.reason !== 'mention' && notification.notif.reason !== 'reply') {
    return notification
  }

  if (!notificationEmailHost) {
    logNotifDebug('immediate action URL skipped: missing notification host', {
      accountId: notification.accountId,
      reason: notification.notif.reason,
      eventId: notification.notif.eventId,
      eventAtMs: notification.notif.eventAtMs,
    })
    return notification
  }

  if (!notification.notif.eventId || !notification.notif.eventAtMs) {
    logNotifDebug('immediate action URL skipped: missing event metadata', {
      accountId: notification.accountId,
      reason: notification.notif.reason,
      eventId: notification.notif.eventId,
      eventAtMs: notification.notif.eventAtMs,
      urlHost: (() => {
        try {
          return new URL(notification.notif.url).host
        } catch {
          return null
        }
      })(),
    })
    return notification
  }

  const actionUrl = buildNotificationReadRedirectUrl({
    notifyServiceHost: notificationEmailHost,
    token: notification.adminToken,
    accountId: notification.accountId,
    eventId: notification.notif.eventId,
    eventAtMs: notification.notif.eventAtMs,
    redirectTo: notification.notif.url,
  })
  logNotifDebug('immediate action URL attached', {
    accountId: notification.accountId,
    reason: notification.notif.reason,
    eventId: notification.notif.eventId,
    eventAtMs: notification.notif.eventAtMs,
    ...getActionUrlLogDetails(actionUrl),
  })

  return {
    ...notification,
    notif: {
      ...notification.notif,
      actionUrl,
    },
  }
}

function withActionUrlLogContext(notification: QueuedNotification) {
  if (
    notification.notif.reason !== 'mention' &&
    notification.notif.reason !== 'reply' &&
    notification.notif.reason !== 'discussion'
  ) {
    return {hasActionUrl: false}
  }
  const actionUrl = notification.notif.actionUrl
  if (!actionUrl) {
    return {hasActionUrl: false}
  }
  return {
    hasActionUrl: true,
    ...getActionUrlLogDetails(actionUrl),
  }
}

async function sendImmediateNotificationEmails(notificationsToSend: NotificationsByEmail) {
  const emailsToSend = Object.entries(notificationsToSend)
  logNotifDebug('immediate notifications ready', {
    uniqueRecipientEmails: emailsToSend.length,
    totalNotifications: emailsToSend.reduce((count, [, notifications]) => count + notifications.length, 0),
  })

  for (const [email, notifications] of emailsToSend) {
    for (const notification of notifications) {
      const notificationWithAction = withImmediateActionUrl(notification)
      const notificationEmail = await createDesktopNotificationsEmail(email, {adminToken: notification.adminToken}, [
        notificationWithAction,
      ])
      if (!notificationEmail) continue
      const {subject, text, html} = notificationEmail
      logNotifDebug('sending immediate notification email', {
        email,
        subject,
        reason: notificationWithAction.notif.reason,
        ...withActionUrlLogContext(notificationWithAction),
      })
      await sendEmail(email, subject, {text, html})
    }
  }
}

async function sendBatchNotificationEmails(notificationsToSend: NotificationsByEmail) {
  const emailsToSend = Object.entries(notificationsToSend)
  logNotifDebug('batch notifications ready', {
    uniqueRecipientEmails: emailsToSend.length,
    totalNotifications: emailsToSend.reduce((count, [, notifications]) => count + notifications.length, 0),
  })

  for (const [email, notifications] of emailsToSend) {
    const firstNotification = notifications[0]
    if (!firstNotification) continue
    const notificationEmail = await createNotificationsEmail(
      email,
      {adminToken: firstNotification.adminToken},
      notifications,
    )
    if (!notificationEmail) continue
    const {subject, text, html} = notificationEmail
    logNotifDebug('sending batch notification email', {
      email,
      subject,
      notificationsCount: notifications.length,
      reasons: notifications.map((notification) => notification.notif.reason),
    })
    await sendEmail(email, subject, {text, html})
  }
}

async function processImmediateNotifications(events: PlainMessage<Event>[]) {
  if (!events.length) return
  const allEmails = getAllEmails()
  const emailIdentityMap = buildEmailIdentityMap(allEmails)
  const subscriptions = getImmediateSubscriptions(emailIdentityMap)
  const notificationsToSend = await collectNotificationsForEvents({
    events,
    subscriptions,
    deliveryKind: 'immediate',
    emailIdentityMap,
  })
  await sendImmediateNotificationEmails(notificationsToSend)
}

async function processBatchNotifications(events: PlainMessage<Event>[]) {
  if (!events.length) return
  const allEmails = getAllEmails()
  const emailIdentityMap = buildEmailIdentityMap(allEmails)
  const subscriptions = getBatchSubscriptions(allEmails, emailIdentityMap)
  const notificationsToSend = await collectNotificationsForEvents({
    events,
    subscriptions,
    deliveryKind: 'batch',
    emailIdentityMap,
  })
  await sendBatchNotificationEmails(notificationsToSend)
}

function getEventId(event: PlainMessage<Event>) {
  if (event.data.case === 'newBlob') {
    if (!event.data.value) return undefined
    return `blob-${event.data.value.cid}`
  }
  if (event.data.case === 'newMention') {
    if (!event.data.value) return undefined
    const {sourceBlob, mentionType, target} = event.data.value
    const normalizedMentionType = typeof mentionType === 'string' ? mentionType : ''
    const normalizedTarget = typeof target === 'string' ? target : ''
    return `mention-${sourceBlob?.cid}-${normalizedMentionType}-${normalizedTarget}`
  }
  return undefined
}

type EventCursorFingerprint = {kind: 'blob'; cid: string} | {kind: 'mention'; cid: string}

function getEventCursorFingerprint(event: PlainMessage<Event>): EventCursorFingerprint | null {
  if (event.data.case === 'newBlob') {
    const cid = event.data.value?.cid
    if (!cid) return null
    return {kind: 'blob', cid}
  }
  if (event.data.case === 'newMention') {
    const cid = event.data.value?.sourceBlob?.cid
    if (!cid) return null
    return {kind: 'mention', cid}
  }
  return null
}

function parseCursorFingerprintFromId(eventId: string): EventCursorFingerprint | null {
  if (eventId.startsWith('blob-')) {
    const cid = eventId.slice('blob-'.length)
    if (!cid) return null
    return {kind: 'blob', cid}
  }
  if (eventId.startsWith('mention-')) {
    const withoutPrefix = eventId.slice('mention-'.length)
    const firstDash = withoutPrefix.indexOf('-')
    if (firstDash <= 0) return null
    const cid = withoutPrefix.slice(0, firstDash)
    if (!cid) return null
    return {kind: 'mention', cid}
  }
  return null
}

function matchesCursorEvent(event: PlainMessage<Event>, eventId: string | undefined, lastProcessedEventId: string) {
  if (eventId && eventId === lastProcessedEventId) return true
  const cursorFingerprint = parseCursorFingerprintFromId(lastProcessedEventId)
  const eventFingerprint = getEventCursorFingerprint(event)
  if (!cursorFingerprint || !eventFingerprint) return false
  return cursorFingerprint.kind === eventFingerprint.kind && cursorFingerprint.cid === eventFingerprint.cid
}

function getEventAtMs(event: PlainMessage<Event>): number {
  const eventTime = normalizeDate(event.eventTime)
  const observeTime = normalizeDate(event.observeTime)
  if (eventTime && observeTime) {
    return Math.max(eventTime.getTime(), observeTime.getTime())
  }
  if (eventTime) return eventTime.getTime()
  if (observeTime) return observeTime.getTime()
  return Date.now()
}

async function evaluateEventForNotifications(
  event: PlainMessage<Event>,
  allSubscriptions: NotificationSubscription[],
  appendNotification: (subscription: NotificationSubscription, notif: Notification) => Promise<void>,
  options: {mentionSourceBlobCids: Set<string>},
) {
  const eventTime = normalizeDate(event.eventTime)
  const observeTime = normalizeDate(event.observeTime)
  // the "consideration time" is the newest of the event time and the observe time
  const considerationTime =
    eventTime && observeTime ? Math.max(eventTime.getTime(), observeTime.getTime()) : eventTime || observeTime
  // if the consideration time is older than the emailBatchNotifIntervalHours, we ignore it and print an error
  if (considerationTime && considerationTime < new Date(Date.now() - emailBatchNotifIntervalHours * 60 * 60 * 1000)) {
    const eventId = getEventId(event) || 'unknown-event'
    if (!reportedOldEventIds.has(eventId)) {
      if (reportedOldEventIds.size > 5_000) reportedOldEventIds.clear()
      reportedOldEventIds.add(eventId)
      console.warn(`[notify][email] skip old event ${eventId} older than ${emailBatchNotifIntervalHours} hours`)
    }
    return
  }
  const eventMeta: NotificationEventMeta = {
    eventId: getEventId(event),
    eventAtMs: getEventAtMs(event),
  }
  logNotifDebug('evaluate event', {
    eventId: eventMeta.eventId,
    eventAtMs: eventMeta.eventAtMs,
    eventCase: event.data.case,
    account: event.account,
  })

  if (event.data.case === 'newMention') {
    logNotifDebug('processing newMention event', {
      eventId: eventMeta.eventId,
      target: event.data.value?.target,
      source: event.data.value?.source,
      sourceType: event.data.value?.sourceType,
      sourceDocument: event.data.value?.sourceDocument,
    })
    await evaluateMentionEventForNotifications(
      event.data.value,
      allSubscriptions,
      appendNotification,
      eventMeta,
      event.account,
    )
    return
  }

  if (event.data.case === 'newBlob') {
    const blob = event.data.value
    logNotifDebug('processing newBlob event', {
      eventId: eventMeta.eventId,
      blobType: blob.blobType,
      cid: blob.cid,
    })
    if (blob.blobType === 'Ref') {
      const refStartTime = Date.now()
      const refEvent = await loadRefEvent(event)
      const refTime = Date.now() - refStartTime
      if (refTime > 5000) {
        reportError(`Slow loadRefEvent: ${blob.cid} took ${refTime}ms (threshold: 5000ms)`)
      }
      await evaluateDocUpdateForNotifications(refEvent, allSubscriptions, appendNotification)
    }
    if (blob.blobType === 'Comment') {
      const commentStartTime = Date.now()
      const serverComment = await grpcClient.comments.getComment({id: blob.cid})
      const commentTime = Date.now() - commentStartTime
      if (commentTime > 5000) {
        reportError(`Slow getComment: ${blob.cid} took ${commentTime}ms (threshold: 5000ms)`)
      }
      const rawComment = toPlainMessage(serverComment)
      const comment = HMCommentSchema.parse(rawComment)
      const includeMentionsFromBody = !options.mentionSourceBlobCids.has(blob.cid)
      await evaluateNewCommentForNotifications(comment, allSubscriptions, appendNotification, eventMeta, {
        includeMentionsFromBody,
      })
    }
  }
}

async function evaluateDocUpdateForNotifications(
  refEvent: {
    newMentions: MentionMap
    isNewDocument: boolean
    openUrl: string
    metadata: HMMetadata
    id: UnpackedHypermediaId
    authorId: string
    authorMeta: HMMetadata
  },
  allSubscriptions: NotificationSubscription[],
  appendNotification: (subscription: NotificationSubscription, notif: Notification) => Promise<void>,
) {
  for (const sub of allSubscriptions) {
    if (sub.notifyAllMentions && refEvent.newMentions[sub.id]) {
      const subjectAccountResult = await requestAPI('Account', sub.id)
      const subjectAccountMeta = subjectAccountResult.type === 'account' ? subjectAccountResult.metadata : null
      appendNotification(sub, {
        reason: 'mention',
        source: 'document',
        authorAccountId: refEvent.authorId,
        authorMeta: refEvent.authorMeta,
        targetMeta: refEvent.metadata,
        subjectAccountId: sub.id,
        subjectAccountMeta,
        targetId: refEvent.id,
        url: refEvent.openUrl,
      })
    }
    // if (sub.notifyOwnedDocChange) {} // TODO: implement this
  }
}

async function getAccountSiteBaseUrl(accountId: string): Promise<string> {
  try {
    const accountResult = await requestAPI('Account', accountId)
    if (accountResult.type === 'account') {
      return accountResult.metadata?.siteUrl?.replace(/\/$/, '') || SITE_BASE_URL.replace(/\/$/, '')
    }
  } catch (error: any) {
    reportError(`Error getting account site url ${accountId}: ${error.message}`)
  }
  return SITE_BASE_URL.replace(/\/$/, '')
}

async function evaluateMentionEventForNotifications(
  mentionEvent: any,
  allSubscriptions: NotificationSubscription[],
  appendNotification: (subscription: NotificationSubscription, notif: Notification) => Promise<void>,
  eventMeta: NotificationEventMeta,
  fallbackAuthorAccountId: string,
) {
  if (!mentionEvent) {
    logNotifDebug('skip mention: missing mention payload', {
      eventId: eventMeta.eventId,
    })
    return
  }

  const targetId = unpackHmId(mentionEvent.target)
  if (!targetId || targetId.path?.length) {
    logNotifDebug('skip mention: target is not account root', {
      eventId: eventMeta.eventId,
      target: mentionEvent.target,
      parsedTargetUid: targetId?.uid,
      parsedTargetPath: targetId?.path,
    })
    return
  }

  const sourceType = mentionEvent.sourceType?.toLowerCase() || ''
  const isCommentMention = sourceType.startsWith('comment/')
  const sourceHref = isCommentMention && mentionEvent.sourceDocument ? mentionEvent.sourceDocument : mentionEvent.source
  const sourceId = unpackHmId(sourceHref)
  if (!sourceId) {
    logNotifDebug('skip mention: unable to parse source href', {
      eventId: eventMeta.eventId,
      sourceHref,
      sourceType,
    })
    return
  }

  const sourceDocId = hmId(sourceId.uid, {
    path: sourceId.path,
    version: sourceId.version || null,
  })

  let targetMeta: HMMetadata | null = null
  try {
    targetMeta = (await requestAPI('ResourceMetadata', sourceDocId)).metadata
  } catch (error: any) {
    reportError(`Error getting source metadata for mention ${sourceDocId.id}: ${error.message}`)
  }

  const authorAccountId = mentionEvent.sourceBlob?.author || fallbackAuthorAccountId
  let authorMeta: HMMetadata | null = null
  try {
    const authorResult = await requestAPI('Account', authorAccountId)
    authorMeta = authorResult.type === 'account' ? authorResult.metadata : null
  } catch (error: any) {
    reportError(`Error getting mention author ${authorAccountId}: ${error.message}`)
  }

  const siteBaseUrl = await getAccountSiteBaseUrl(sourceDocId.uid)

  let mentionUrl: string
  let mentionComment: HMComment | undefined
  if (isCommentMention) {
    const sourceCommentId = unpackHmId(mentionEvent.source)
    const commentPath = sourceCommentId?.path?.[0]
    if (!sourceCommentId || !commentPath) {
      return
    }
    mentionUrl = createWebHMUrl(sourceCommentId.uid, {
      path: [commentPath],
      hostname: siteBaseUrl,
    })
    try {
      const sourceBlobCid = mentionEvent.sourceBlob?.cid
      if (sourceBlobCid) {
        const serverComment = await grpcClient.comments.getComment({
          id: sourceBlobCid,
        })
        const rawComment = toPlainMessage(serverComment)
        mentionComment = HMCommentSchema.parse(rawComment)
      }
    } catch (error: any) {
      reportError(`Error loading mention comment ${mentionEvent.sourceBlob?.cid}: ${error.message}`)
    }
  } else {
    mentionUrl = createWebHMUrl(sourceDocId.uid, {
      path: sourceDocId.path,
      hostname: siteBaseUrl,
    })
  }

  for (const sub of allSubscriptions) {
    if (!sub.notifyAllMentions || sub.id !== targetId.uid) continue
    const subjectAccountResult = await requestAPI('Account', sub.id)
    const subjectAccountMeta = subjectAccountResult.type === 'account' ? subjectAccountResult.metadata : null
    await appendNotification(sub, {
      reason: 'mention',
      source: isCommentMention ? 'comment' : 'document',
      authorAccountId,
      authorMeta,
      targetMeta,
      subjectAccountId: sub.id,
      subjectAccountMeta,
      targetId: sourceDocId,
      url: mentionUrl,
      comment: mentionComment,
      eventId: eventMeta.eventId,
      eventAtMs: eventMeta.eventAtMs,
    })
    logNotifDebug('mention notification queued', {
      eventId: eventMeta.eventId,
      subscriptionAccountId: sub.id,
      subscriptionEmail: sub.email,
      mentionUrl,
      sourceType,
    })
  }

  const matchingSubscriptions = allSubscriptions.filter((sub) => sub.notifyAllMentions && sub.id === targetId.uid)
  if (!matchingSubscriptions.length) {
    logNotifDebug('skip mention: no matching subscriptions', {
      eventId: eventMeta.eventId,
      targetAccountId: targetId.uid,
      totalSubscriptions: allSubscriptions.length,
    })
  }
}

async function evaluateNewCommentForNotifications(
  comment: HMComment,
  allSubscriptions: NotificationSubscription[],
  appendNotification: (subscription: NotificationSubscription, notif: Notification) => Promise<void>,
  eventMeta: NotificationEventMeta,
  options: {includeMentionsFromBody: boolean},
) {
  logNotifDebug('evaluate comment notification', {
    eventId: eventMeta.eventId,
    commentId: comment.id,
    commentAuthor: comment.author,
    targetAccount: comment.targetAccount,
    hasReplyParent: Boolean(comment.replyParent),
    includeMentionsFromBody: options.includeMentionsFromBody,
  })
  const parentStartTime = Date.now()
  const parentComments = await getParentComments(comment)
  const parentTime = Date.now() - parentStartTime
  if (parentTime > 5000) {
    reportError(
      `Slow getParentComments: ${comment.id} took ${parentTime}ms for ${parentComments.length} parents (threshold: 5000ms)`,
    )
  }
  let commentAuthorMeta: HMMetadata | null = null
  let targetMeta: HMMetadata | null = null
  let targetAccountSiteUrl: string | null = null

  try {
    const authorResult = await requestAPI('Account', comment.author)
    commentAuthorMeta = authorResult.type === 'account' ? authorResult.metadata : null
  } catch (error: any) {
    reportError(`Error getting comment author ${comment.author}: ${error.message}`)
  }

  // Get target account metadata to get siteUrl for email links
  try {
    const targetAccountResult = await requestAPI('Account', comment.targetAccount)
    if (targetAccountResult.type === 'account') {
      targetAccountSiteUrl = targetAccountResult.metadata?.siteUrl?.replace(/\/$/, '') || null
    }
  } catch (error: any) {
    reportError(`Error getting target account ${comment.targetAccount}: ${error.message}`)
  }

  try {
    targetMeta = (
      await requestAPI(
        'ResourceMetadata',
        hmId(comment.targetAccount, {
          path: entityQueryPathToHmIdPath(comment.targetPath),
        }),
      )
    ).metadata
  } catch (error: any) {
    reportError(`Error getting target metadata for ${comment.targetAccount}: ${error.message}`)
  }

  // Create comment-specific URL for comment-related notifications
  // Use the target account's siteUrl if available, otherwise fall back to SITE_BASE_URL
  const commentIdParts = comment.id.split('/')
  const commentTSID = commentIdParts[1]
  if (!commentTSID) {
    throw new Error('Invalid comment ID format: ' + comment.id)
  }
  const commentBaseUrl = targetAccountSiteUrl || SITE_BASE_URL.replace(/\/$/, '')
  const commentUrl = createWebHMUrl(comment.author, {
    path: [commentTSID],
    hostname: commentBaseUrl,
  })

  const targetDocId = hmId(comment.targetAccount, {
    path: entityQueryPathToHmIdPath(comment.targetPath),
  })

  // Get all mentioned users in this comment
  const mentionedUsers = options.includeMentionsFromBody
    ? extractMentionedAccountUidsFromComment(comment)
    : new Set<string>()

  // Get the parent comment author for reply notifications
  let parentCommentAuthor: string | null = null
  if (comment.replyParent) {
    try {
      const parentComment = await requestAPI('Comment', comment.replyParent)
      if (parentComment) {
        parentCommentAuthor = parentComment.author
      }
    } catch (error: any) {
      reportError(`Error getting parent comment ${comment.replyParent}: ${error.message}`)
    }
  }

  for (const sub of allSubscriptions) {
    const commentReason = classifyCommentNotificationForAccount({
      subscriptionAccountUid: sub.id,
      commentAuthorUid: comment.author,
      targetAccountUid: comment.targetAccount,
      isTopLevelComment: !comment.threadRoot,
      parentCommentAuthorUid: parentCommentAuthor,
      mentionedAccountUids: mentionedUsers,
    })

    if (commentReason === 'mention' && sub.notifyAllMentions) {
      const subjectAccountResult = await requestAPI('Account', sub.id)
      if (subjectAccountResult.type !== 'account') {
        throw new Error(`Error getting subject account meta for ${sub.id}`)
      }
      await appendNotification(sub, {
        reason: 'mention',
        source: 'comment',
        authorAccountId: comment.author,
        authorMeta: commentAuthorMeta,
        targetMeta: targetMeta,
        targetId: targetDocId,
        url: commentUrl,
        subjectAccountId: sub.id,
        subjectAccountMeta: subjectAccountResult.metadata,
        eventId: eventMeta.eventId,
        eventAtMs: eventMeta.eventAtMs,
      })
      logNotifDebug('comment mention notification queued', {
        eventId: eventMeta.eventId,
        subscriptionAccountId: sub.id,
        subscriptionEmail: sub.email,
        commentId: comment.id,
      })
      continue
    }
    if (commentReason === 'reply' && sub.notifyAllReplies) {
      await appendNotification(sub, {
        reason: 'reply',
        comment: comment,
        parentComments: parentComments,
        authorMeta: commentAuthorMeta,
        targetMeta: targetMeta,
        targetId: targetDocId,
        url: commentUrl,
        eventId: eventMeta.eventId,
        eventAtMs: eventMeta.eventAtMs,
      })
      logNotifDebug('reply notification queued', {
        eventId: eventMeta.eventId,
        subscriptionAccountId: sub.id,
        subscriptionEmail: sub.email,
        commentId: comment.id,
        parentCommentAuthor,
      })
      continue
    }
    if (commentReason === 'discussion' && sub.notifySiteDiscussions) {
      await appendNotification(sub, {
        reason: 'site-new-discussion',
        comment: comment,
        parentComments: parentComments,
        authorMeta: commentAuthorMeta,
        targetMeta: targetMeta,
        targetId: targetDocId,
        url: commentUrl,
      })
      logNotifDebug('site discussion notification queued', {
        eventId: eventMeta.eventId,
        subscriptionAccountId: sub.id,
        subscriptionEmail: sub.email,
        commentId: comment.id,
      })
    }
  }
}

async function getParentComments(comment: HMComment) {
  const parentComments: HMComment[] = []
  let currentComment = comment
  while (currentComment.replyParent) {
    try {
      const parentCommentRaw = await grpcClient.comments.getComment({
        id: currentComment.replyParent,
      })
      const parentCommentPlain = toPlainMessage(parentCommentRaw)
      const parentComment = HMCommentSchema.parse(parentCommentPlain)
      parentComments.push(parentComment)
      currentComment = parentComment
    } catch (error: any) {
      // Handle ConnectError for NotFound comments gracefully
      if (error?.code === 'not_found' || error?.message?.includes('not found')) {
        console.warn(`Parent comment ${currentComment.replyParent} not found, stopping parent traversal`)
        break // Stop traversing up the parent chain
      }
      // Re-throw other errors
      throw error
    }
  }
  return parentComments
}

function markEventsAsProcessed(events: PlainMessage<Event>[]) {
  const newestEvent = events.at(0)
  if (!newestEvent) return
  const lastProcessedEventId = getEventId(newestEvent)
  if (!lastProcessedEventId) return
  console.log('Setting notifier last processed event ID to ' + lastProcessedEventId)
  setNotifierLastProcessedEventId(lastProcessedEventId)
}

// Maximum pages to fetch when looking for lastProcessedEventId
// This prevents infinite loops if the event ID is no longer in the feed
const MAX_EVENT_PAGES = 100
const EVENT_PAGE_SIZE = 20

// Timeout for individual gRPC calls to prevent hanging
const GRPC_CALL_TIMEOUT_MS = 10_000

async function withGrpcTimeout<T>(promise: Promise<T>, operationName: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${operationName} timed out after ${GRPC_CALL_TIMEOUT_MS}ms`)),
      GRPC_CALL_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

type LoadEventsResult = {
  events: PlainMessage<Event>[]
  foundCursor: boolean
  aborted: boolean
}

async function loadEventsAfterEventId(lastProcessedEventId: string, signal?: AbortSignal): Promise<LoadEventsResult> {
  const startTime = Date.now()
  const eventsAfterEventId: PlainMessage<Event>[] = []
  let currentPageToken: string | undefined
  let pageCount = 0

  while (pageCount < MAX_EVENT_PAGES) {
    // Check if we've been aborted - return what we have instead of throwing
    if (signal?.aborted) {
      const totalTime = Date.now() - startTime
      console.warn(
        `loadEventsAfterEventId aborted after ${pageCount} pages, ${totalTime}ms. ` +
          `Returning ${eventsAfterEventId.length} events collected so far.`,
      )
      return {events: eventsAfterEventId, foundCursor: false, aborted: true}
    }

    pageCount++
    const pageStartTime = Date.now()

    let events: PlainMessage<Event>[]
    let nextPageToken: string | undefined
    try {
      const response = await withGrpcTimeout(
        grpcClient.activityFeed.listEvents({
          pageToken: currentPageToken,
          pageSize: EVENT_PAGE_SIZE,
        }),
        `listEvents page ${pageCount}`,
      )
      events = response.events.map((e) => toPlainMessage(e))
      nextPageToken = response.nextPageToken
    } catch (error: any) {
      const totalTime = Date.now() - startTime
      reportError(
        `loadEventsAfterEventId failed on page ${pageCount} after ${totalTime}ms: ${error.message}. ` +
          `Returning ${eventsAfterEventId.length} events collected so far.`,
      )
      // Return what we have instead of throwing
      return {events: eventsAfterEventId, foundCursor: false, aborted: false}
    }

    const pageTime = Date.now() - pageStartTime
    if (pageTime > 5000) {
      reportError(`Slow gRPC call: listEvents page ${pageCount} took ${pageTime}ms (threshold: 5000ms)`)
    } else if (pageTime > 1000) {
      console.warn(`loadEventsAfterEventId page ${pageCount} took ${pageTime}ms (${events.length} events)`)
    }

    for (const event of events) {
      const eventId = getEventId(event)
      if (matchesCursorEvent(event, eventId, lastProcessedEventId)) {
        const totalTime = Date.now() - startTime
        if (totalTime > 5000) {
          console.log(
            `loadEventsAfterEventId found target after ${pageCount} pages, ${eventsAfterEventId.length} events, ${totalTime}ms`,
          )
        }
        return {events: eventsAfterEventId, foundCursor: true, aborted: false}
      }
      if (eventId) {
        eventsAfterEventId.push(event)
      }
    }

    if (!nextPageToken) break
    currentPageToken = nextPageToken
  }

  const totalTime = Date.now() - startTime

  if (pageCount >= MAX_EVENT_PAGES) {
    reportError(
      `loadEventsAfterEventId hit max pages (${MAX_EVENT_PAGES}) after ${totalTime}ms. ` +
        `lastProcessedEventId "${lastProcessedEventId}" not found. ` +
        `Collected ${eventsAfterEventId.length} newer events.`,
    )
  } else if (eventsAfterEventId.length > 0) {
    reportError(
      `loadEventsAfterEventId exhausted feed after ${pageCount} pages, ${totalTime}ms. ` +
        `lastProcessedEventId "${lastProcessedEventId}" not found in feed. ` +
        `Collected ${eventsAfterEventId.length} events.`,
    )
  }

  return {events: eventsAfterEventId, foundCursor: false, aborted: false}
}

async function loadRefEvent(event: PlainMessage<Event>) {
  if (event.data.case !== 'newBlob') throw new Error('Invalid event for loadRefEvent')
  const blob = event.data.value
  const id = unpackHmId(blob.resource)

  if (!id?.uid) throw new Error('Invalid ref event for resource: ' + blob.resource)

  const refData = await loadRefFromIpfs(blob.cid)

  const changeCid = refData.heads?.[0]?.toString()

  const changeData = await loadRefFromIpfs(changeCid)

  const changedDoc = await getDocument(id)

  // Get the home account's siteUrl to use in email links
  const homeAccountResult = await requestAPI('Account', id.uid)
  const siteUrl = homeAccountResult.type === 'account' ? homeAccountResult.metadata?.siteUrl?.replace(/\/$/, '') : null
  const baseUrl = siteUrl || SITE_BASE_URL.replace(/\/$/, '')

  const openUrl = `${baseUrl}/hm/${id.uid}/${(id.path || []).join('/')}`

  const prevVersionId = {
    ...id,
    version:
      changeData.deps && changeData.deps.length > 0
        ? changeData.deps.map((cid: CID) => cid.toString()).join('.')
        : null,
  }

  const isNewDocument = Array.isArray(changeData.deps) && changeData.deps.length === 0

  const currentDocMentions = getMentionsOfDocument(changedDoc)

  let newMentions: MentionMap = currentDocMentions
  // Check if there are previous mentions to compare against
  if (prevVersionId?.version) {
    const prevVersionDoc = await getDocument(prevVersionId)
    const prevVersionDocMentions = getMentionsOfDocument(prevVersionDoc)
    newMentions = {}
    for (const [blockId, mentions] of Object.entries(currentDocMentions)) {
      const prevMentions = prevVersionDocMentions[blockId]
      if (!prevMentions) {
        // Entirely new block with mentions
        newMentions[blockId] = mentions
      } else {
        // Check for new mentions in existing block
        const addedMentions = new Set(Array.from(mentions).filter((m) => !prevMentions.has(m)))
        if (addedMentions.size > 0) {
          newMentions[blockId] = addedMentions
        }
      }
    }
  }
  const authorResult = await requestAPI('Account', blob.author)
  if (authorResult.type !== 'account' || !authorResult.metadata)
    throw new Error('Error getting author meta for ' + blob.author)
  const authorMeta = authorResult.metadata
  return {
    id,
    newMentions,
    isNewDocument,
    openUrl,
    metadata: changedDoc.metadata,
    authorId: blob.author,
    authorMeta,
  }
}

type MentionMap = Record<string, Set<string>> // block id -> set of account ids

function getMentionsOfDocument(document: HMDocument): MentionMap {
  const mentionMap: MentionMap = {}
  extractMentionsFromBlockNodes(document.content, mentionMap)
  return mentionMap
}

function extractMentionsFromBlockNodes(content: HMBlockNode[], mentionMap: MentionMap) {
  for (const blockNode of content) {
    extractMentionsFromBlockNode(blockNode, mentionMap)
  }
}

function extractMentionsFromBlockNode(blockNode: HMBlockNode, mentionMap: MentionMap) {
  const {block, children} = blockNode

  const annotations = getAnnotations(block)
  if (annotations) {
    for (const annotation of annotations) {
      if (annotation.type === 'Embed' && annotation.link.startsWith('hm://')) {
        const hmUidAndPath = annotation.link.slice(5)
        if (
          hmUidAndPath &&
          // ignore mentions to documents
          !hmUidAndPath.includes('/')
        ) {
          mentionMap[block.id] = mentionMap[block.id] ?? new Set()
          mentionMap[block.id]!.add(hmUidAndPath)
        }
      }
    }
  }
  if (children) extractMentionsFromBlockNodes(children, mentionMap)
}

// Timeout for IPFS fetches to prevent hanging when daemon is slow/unresponsive.
// Without this, a single slow/missing CID can block the entire notification system.
const IPFS_FETCH_TIMEOUT_MS = 5_000

async function loadRefFromIpfs(cid: string): Promise<any> {
  const url = `${DAEMON_HTTP_URL}/ipfs/${cid}`

  // Use AbortController for fetch timeout since fetch() doesn't have native timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {signal: controller.signal})

    // Check HTTP status before attempting to decode - a 404/500 would cause CBOR decode errors
    if (!response.ok) {
      throw new Error(`IPFS fetch failed for CID ${cid}: HTTP ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return cborDecode(new Uint8Array(buffer))
  } catch (error: any) {
    // Convert AbortError to more descriptive timeout error
    if (error.name === 'AbortError') {
      throw new Error(`IPFS fetch timed out after ${IPFS_FETCH_TIMEOUT_MS}ms for CID ${cid}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
