import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {
  createCommentEmail,
  createDiscussionEmail,
  createMentionEmail,
  createNotificationsEmail,
  createReplyEmail,
  Notification,
} from '@shm/emails/notifier'
import {
  HMBlockNode,
  HMComment,
  HMCommentSchema,
  HMDocument,
  HMMetadata,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  createWebHMUrl,
  entityQueryPathToHmIdPath,
  Event,
  getAnnotations,
  hmId,
  normalizeDate,
  unpackHmId,
} from '@shm/shared'
import {DAEMON_HTTP_URL, NOTIFY_SERVICE_HOST, SITE_BASE_URL} from '@shm/shared/constants'
import {
  classifyCommentNotificationForAccount,
  extractMentionedAccountUidsFromComment,
  getMentionedAccountUid,
} from '@shm/shared/models/notification-event-classifier'
import {CID} from 'multiformats'
import {
  getAllEmails,
  getAllNotificationConfigs,
  getBatchNotifierLastProcessedEventId,
  getBatchNotifierLastSendTime,
  getInboxRegisteredAccounts,
  getNotifierLastProcessedEventId,
  setBatchNotifierLastProcessedEventId,
  setBatchNotifierLastSendTime,
  setNotifierLastProcessedEventId,
} from './db'
import {sendEmail} from './mailer'
import {getDiscussionNotificationReason, getNotificationDeliveryKind} from './notification-routing'
import type {NotificationDeliveryKind} from './notification-routing'
import {persistNotificationsForInboxAccounts} from './notification-persistence'
import {resolveNotificationAccount} from './notification-account-resolution'
import {buildNotificationReadRedirectUrl} from './notification-read-redirect'
import {grpcClient, requestAPI} from './notify-request'

async function getDocument(id: UnpackedHypermediaId) {
  const resource = await requestAPI('Resource', id)
  if (resource.type === 'document') return resource.document
  if (resource.type === 'redirect') return null
  throw new Error(`Expected document resource, got ${resource.type}`)
}

// Track if notification processing is actually running (survives timeout)
let isNotifProcessingActive = false
let isBatchNotifProcessingActive = false

// Abort controllers for cancelling ongoing work
let currentNotifAbortController: AbortController | null = null
let currentBatchAbortController: AbortController | null = null

const isProd = process.env.NODE_ENV === 'production'

const emailBatchNotifIntervalHours = isProd ? 4 : 0.1 // 6 minute batching for dev
const notificationBackfillMaxAgeMs = 60 * 60 * 1000

const handleImmediateEmailNotificationsIntervalSeconds = 15

const adminEmail = process.env.SEED_DEV_ADMIN_EMAIL || 'eric@seedhypermedia.com'
const notificationEmailHost = (NOTIFY_SERVICE_HOST || SITE_BASE_URL).replace(/\/$/, '')
const fallbackSiteBaseUrl = SITE_BASE_URL.replace(/\/$/, '')
const notifDebugEnabled = process.env.NOTIFY_DEBUG === '1' || process.env.NODE_ENV !== 'production'
const notifVerboseEnabled = process.env.VERBOSE === 'true'

// Error batching for reportError
const errorBatchDelayMs = 30_000 // 30 seconds
let pendingErrors: string[] = []
let errorBatchTimeout: ReturnType<typeof setTimeout> | null = null
const reportedInvalidEventIdentityKeys = new Set<string>()

type NotificationEventMeta = {
  eventId?: string
  eventAtMs: number
}

type NotificationSubscription = {
  id: string
  email: string | null
  adminToken: string | null
  shouldSendEmail: boolean
  source: 'notification-config' | 'inbox-registration' | 'legacy-email-subscription'
  notifyAllMentions: boolean
  notifyAllReplies: boolean
  notifyAllDiscussions: boolean
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

type NotificationCollection = {
  queuedNotifications: QueuedNotification[]
  notificationsByEmail: NotificationsByEmail
}

type EventCursorFingerprint =
  | {kind: 'blob'; cid: string}
  | {kind: 'mention'; cid: string; mentionType: string; target: string}

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

function logNotifVerbose(message: string, details?: Record<string, unknown>) {
  if (!notifVerboseEnabled) return
  if (details) {
    console.info(`[notify][verbose] ${message}`, details)
  } else {
    console.info(`[notify][verbose] ${message}`)
  }
}

function logTriggeredNotification(
  subscription: NotificationSubscription,
  notif: Notification,
  deliveryKind: NotificationDeliveryKind,
) {
  const notifWithEvent = notif as Notification & {
    eventId?: string
    eventAtMs?: number
  }
  const authorAccountId =
    'authorAccountId' in notif
      ? notif.authorAccountId
      : 'comment' in notif && notif.comment
      ? notif.comment.author
      : null

  logNotifVerbose('notification triggered', {
    deliveryKind,
    subscriptionAccountId: subscription.id,
    subscriptionEmail: subscription.email,
    subscriptionSource: subscription.source,
    shouldSendEmail: subscription.shouldSendEmail,
    reason: notif.reason,
    eventId: notifWithEvent.eventId,
    eventAtMs: notifWithEvent.eventAtMs,
    targetAccountId: notif.targetId.uid,
    targetPath: notif.targetId.path ?? null,
    commentId: 'comment' in notif && notif.comment ? notif.comment.id : null,
    authorAccountId,
  })
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

/** Starts the notify server's background loops for immediate and batched notification processing. */
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
  if (!isValidEventCursorId(lastProcessedEventId)) {
    reportError(
      'Batch notifier had invalid cursor value. Resetting to latest valid event ID: ' +
        JSON.stringify({lastProcessedEventId, lastEventId}),
    )
    setBatchNotifierLastSendTime(new Date())
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
    if (!isValidEventCursorId(lastProcessedEventId)) {
      reportError('Invalid notifier last processed event ID found. Resetting: ' + lastProcessedEventId)
      await resetNotifierLastProcessedEventId()
      return
    }
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
  let pageToken: string | undefined
  let skippedInvalidEvents = 0

  for (let pageCount = 0; pageCount < MAX_EVENT_PAGES; pageCount++) {
    const response = await grpcClient.activityFeed.listEvents({
      pageToken,
      pageSize: EVENT_PAGE_SIZE,
    })
    for (const event of response.events) {
      const plainEvent =
        typeof (event as any).toJson === 'function' ? toPlainMessage(event) : (event as PlainMessage<Event>)
      const lastEventId = getEventId(plainEvent)
      if (lastEventId) {
        if (skippedInvalidEvents > 0) {
          console.warn(`[notify][email] skipped ${skippedInvalidEvents} latest events without valid cursor identity`)
        }
        return lastEventId
      }
      skippedInvalidEvents++
      reportInvalidEventIdentity(plainEvent, 'getLastEventId')
    }
    if (!response.nextPageToken) break
    pageToken = response.nextPageToken
  }

  return undefined
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
  const subscriptionsByAccount = new Map<string, NotificationSubscription>()
  const notificationConfigs = getAllNotificationConfigs()
  const inboxRegisteredAccounts = getInboxRegisteredAccounts()
  let verifiedNotificationConfigCount = 0

  for (const config of notificationConfigs) {
    const identity = emailIdentityMap.get(config.email)
    const shouldSendEmail = Boolean(identity && !identity.isUnsubscribed && config.verifiedTime)
    if (config.verifiedTime) {
      verifiedNotificationConfigCount += 1
    }
    subscriptionsByAccount.set(config.accountId, {
      id: config.accountId,
      email: config.email,
      adminToken: identity?.adminToken ?? null,
      shouldSendEmail,
      source: 'notification-config',
      notifyAllMentions: true,
      notifyAllReplies: true,
      notifyAllDiscussions: true,
      notifyOwnedDocChange: false,
      notifySiteDiscussions: false,
    })
  }

  let inboxOnlyCount = 0
  for (const accountId of inboxRegisteredAccounts) {
    if (subscriptionsByAccount.has(accountId)) continue
    subscriptionsByAccount.set(accountId, {
      id: accountId,
      email: null,
      adminToken: null,
      shouldSendEmail: false,
      source: 'inbox-registration',
      notifyAllMentions: true,
      notifyAllReplies: true,
      notifyAllDiscussions: true,
      notifyOwnedDocChange: false,
      notifySiteDiscussions: false,
    })
    inboxOnlyCount += 1
  }

  const subscriptions = Array.from(subscriptionsByAccount.values())
  logNotifVerbose('resolved immediate notification subscriptions', {
    totalSubscriptions: subscriptions.length,
    notificationConfigAccounts: notificationConfigs.length,
    verifiedNotificationConfigs: verifiedNotificationConfigCount,
    inboxRegisteredAccounts: inboxRegisteredAccounts.length,
    inboxOnlyAccounts: inboxOnlyCount,
  })
  return subscriptions
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
        id: subscription.id,
        email: subscription.email,
        adminToken: identity.adminToken,
        shouldSendEmail: true,
        source: 'legacy-email-subscription',
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyAllDiscussions: false,
        notifyOwnedDocChange: subscription.notifyOwnedDocChange,
        notifySiteDiscussions: subscription.notifySiteDiscussions,
      })
    }
  }
  return subscriptions
}

async function collectNotificationsForEvents({
  events,
  subscriptions,
  deliveryKind,
}: {
  events: PlainMessage<Event>[]
  subscriptions: NotificationSubscription[]
  deliveryKind: NotificationDeliveryKind
}): Promise<NotificationCollection> {
  const notificationsToSend: NotificationsByEmail = {}
  const queuedNotifications: QueuedNotification[] = []
  if (!events.length) {
    return {
      notificationsByEmail: notificationsToSend,
      queuedNotifications,
    }
  }
  if (!subscriptions.length) {
    logNotifVerbose('no notification subscriptions available for event evaluation', {
      deliveryKind,
      eventCount: events.length,
    })
  }

  const mentionSourceBlobCids = new Set<string>()
  for (const event of events) {
    if (event.data.case !== 'newMention') continue
    const sourceBlobCid = normalizeCidString(event.data.value?.sourceBlob?.cid)
    if (sourceBlobCid) mentionSourceBlobCids.add(sourceBlobCid)
  }

  logNotifDebug('notification evaluation start', {
    eventCount: events.length,
    deliveryKind,
    subscriptions: subscriptions.length,
  })

  async function appendNotification(subscription: NotificationSubscription, notif: Notification) {
    if (getNotificationDeliveryKind(notif.reason) !== deliveryKind) return
    const queuedNotification: QueuedNotification = {
      accountId: subscription.id,
      adminToken: subscription.adminToken ?? '',
      accountMeta: null,
      notif,
    }
    queuedNotifications.push(queuedNotification)
    if (subscription.shouldSendEmail && subscription.email && subscription.adminToken) {
      notificationsToSend[subscription.email] = notificationsToSend[subscription.email] ?? []
      notificationsToSend[subscription.email]!.push(queuedNotification)
    }
    logTriggeredNotification(subscription, notif, deliveryKind)
  }

  for (const event of events) {
    const eventStartTime = Date.now()
    const eventId = getEventId(event)
    if (!eventId) {
      reportInvalidEventIdentity(event, 'collectNotificationsForEvents')
      continue
    }
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

  return {
    notificationsByEmail: notificationsToSend,
    queuedNotifications,
  }
}

function withImmediateActionUrl(notification: QueuedNotification): QueuedNotification {
  if (
    notification.notif.reason !== 'mention' &&
    notification.notif.reason !== 'reply' &&
    notification.notif.reason !== 'discussion'
  ) {
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

/** Build an individual email for a single immediate notification using the new mockup-matching templates. */
function buildImmediateNotificationEmail(
  notification: QueuedNotification,
): {subject: string; text: string; html: string} | null {
  const {notif, adminToken} = notification
  const unsubscribeUrl = `${notificationEmailHost}/hm/email-notifications?token=${adminToken}`
  const authorName = notif.authorMeta?.name || 'Someone'
  const documentName = notif.targetMeta?.name || 'Untitled Document'
  const siteUrl = extractSiteOrigin(notif.url)

  if (notif.reason === 'mention') {
    const subjectName = notification.accountMeta?.name || 'you'
    return createMentionEmail({
      authorName,
      subjectName,
      documentName,
      commentBlocks: notif.comment?.content || [],
      actionUrl: notif.actionUrl || notif.url,
      unsubscribeUrl,
      siteUrl,
      resolvedNames: notif.resolvedNames,
    })
  }

  if (notif.reason === 'reply') {
    return createReplyEmail({
      authorName,
      documentName,
      commentBlocks: notif.comment.content,
      actionUrl: notif.actionUrl || notif.url,
      unsubscribeUrl,
      siteUrl,
      resolvedNames: notif.resolvedNames,
    })
  }

  if (notif.reason === 'discussion') {
    return createDiscussionEmail({
      authorName,
      documentName,
      commentBlocks: notif.comment.content,
      actionUrl: notif.actionUrl || notif.url,
      unsubscribeUrl,
      siteUrl,
    })
  }

  // Fallback for any other reason — should not happen for immediate notifications
  return null
}

/** Extract the origin (protocol + host) from a URL. */
function extractSiteOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
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
      const notificationEmail = buildImmediateNotificationEmail(notificationWithAction)
      if (!notificationEmail) continue
      const {subject, text, html} = notificationEmail
      const reason = notificationWithAction.notif.reason
      const unsubscribeUrl = `${notificationEmailHost}/hm/api/unsubscribe?token=${notification.adminToken}`
      logNotifDebug('sending immediate notification email', {
        email,
        subject,
        reason,
        ...withActionUrlLogContext(notificationWithAction),
      })
      await sendEmail(email, subject, {text, html}, undefined, {
        unsubscribeUrl,
        feedbackId: reason,
      })
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
    const batchUnsubscribeUrl = `${notificationEmailHost}/hm/api/unsubscribe?token=${firstNotification.adminToken}`
    logNotifDebug('sending batch notification email', {
      email,
      subject,
      notificationsCount: notifications.length,
      reasons: notifications.map((notification) => notification.notif.reason),
    })
    await sendEmail(email, subject, {text, html}, undefined, {
      unsubscribeUrl: batchUnsubscribeUrl,
      feedbackId: 'batch',
    })
  }
}

async function processImmediateNotifications(events: PlainMessage<Event>[]) {
  if (!events.length) return
  const allEmails = getAllEmails()
  const emailIdentityMap = buildEmailIdentityMap(allEmails)
  const subscriptions = getImmediateSubscriptions(emailIdentityMap)
  const notificationCollection = await collectNotificationsForEvents({
    events,
    subscriptions,
    deliveryKind: 'immediate',
  })
  await sendImmediateNotificationEmails(notificationCollection.notificationsByEmail)
  const inboxItems = notificationCollection.queuedNotifications.flatMap((notification) => {
    const notifWithEvent = notification.notif as Notification & {
      eventId?: string
      eventAtMs?: number
    }
    if (!notifWithEvent.eventId || !notifWithEvent.eventAtMs) {
      return []
    }
    return [
      {
        accountId: notification.accountId,
        notif: notification.notif,
        eventId: notifWithEvent.eventId,
        eventAtMs: notifWithEvent.eventAtMs,
      },
    ]
  })
  const persistedCount = persistNotificationsForInboxAccounts(inboxItems)
  logNotifVerbose('notification inbox persistence complete', {
    sourceEventCount: events.length,
    queuedNotifications: notificationCollection.queuedNotifications.length,
    emailNotifications: Object.values(notificationCollection.notificationsByEmail).reduce(
      (count, notifications) => count + notifications.length,
      0,
    ),
    inboxItems: inboxItems.length,
    persistedCount,
  })
}

async function processBatchNotifications(events: PlainMessage<Event>[]) {
  if (!events.length) return
  const allEmails = getAllEmails()
  const emailIdentityMap = buildEmailIdentityMap(allEmails)
  const subscriptions = getBatchSubscriptions(allEmails, emailIdentityMap)
  const notificationCollection = await collectNotificationsForEvents({
    events,
    subscriptions,
    deliveryKind: 'batch',
  })
  await sendBatchNotificationEmails(notificationCollection.notificationsByEmail)
  // Note: inbox persistence already handled in processImmediateNotifications.
  // Batch events were already persisted when they were first processed as immediate.
}

/** Returns the stable notifier cursor ID for activity events with valid identity fields. */
export function getEventId(event: PlainMessage<Event>) {
  const fingerprint = getEventCursorFingerprint(event)
  if (!fingerprint) return undefined
  return formatEventCursorId(fingerprint)
}

function getEventCursorFingerprint(event: PlainMessage<Event>): EventCursorFingerprint | null {
  if (event.data.case === 'newBlob') {
    const cid = normalizeCidString(event.data.value?.cid)
    if (!cid) return null
    return {kind: 'blob', cid}
  }
  if (event.data.case === 'newMention') {
    const mention = event.data.value
    const cid = normalizeCidString(mention?.sourceBlob?.cid)
    const target = normalizeRequiredString(mention?.target)
    if (!cid || !target) return null
    const mentionType = typeof mention?.mentionType === 'string' ? mention.mentionType : ''
    return {kind: 'mention', cid, mentionType, target}
  }
  return null
}

function parseCursorFingerprintFromId(eventId: string): EventCursorFingerprint | null {
  if (eventId.startsWith('blob-')) {
    const cid = normalizeCidString(eventId.slice('blob-'.length))
    if (!cid) return null
    return {kind: 'blob', cid}
  }
  if (eventId.startsWith('mention-')) {
    const withoutPrefix = eventId.slice('mention-'.length)
    const firstDash = withoutPrefix.indexOf('-')
    if (firstDash <= 0) return null
    const cid = normalizeCidString(withoutPrefix.slice(0, firstDash))
    const withoutCid = withoutPrefix.slice(firstDash + 1)
    const secondDash = withoutCid.indexOf('-')
    if (!cid || secondDash < 0) return null
    const mentionType = withoutCid.slice(0, secondDash)
    const target = normalizeRequiredString(withoutCid.slice(secondDash + 1))
    if (!target) return null
    return {kind: 'mention', cid, mentionType, target}
  }
  return null
}

/** Returns whether an activity event matches a stored notifier cursor ID. */
export function matchesCursorEvent(
  event: PlainMessage<Event>,
  eventId: string | undefined,
  lastProcessedEventId: string,
) {
  if (eventId && eventId === lastProcessedEventId) return true
  const cursorFingerprint = parseCursorFingerprintFromId(lastProcessedEventId)
  const eventFingerprint = getEventCursorFingerprint(event)
  if (!cursorFingerprint || !eventFingerprint) return false
  return isSameEventCursorFingerprint(cursorFingerprint, eventFingerprint)
}

function isValidEventCursorId(eventId: string) {
  return parseCursorFingerprintFromId(eventId) !== null
}

function formatEventCursorId(fingerprint: EventCursorFingerprint) {
  if (fingerprint.kind === 'blob') {
    return `blob-${fingerprint.cid}`
  }
  return `mention-${fingerprint.cid}-${fingerprint.mentionType}-${fingerprint.target}`
}

function isSameEventCursorFingerprint(left: EventCursorFingerprint, right: EventCursorFingerprint) {
  if (left.kind !== right.kind || left.cid !== right.cid) return false
  if (left.kind === 'blob' || right.kind === 'blob') return true
  return left.mentionType === right.mentionType && left.target === right.target
}

function normalizeCidString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return CID.parse(trimmed).toString()
  } catch {
    return null
  }
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function reportInvalidEventIdentity(event: PlainMessage<Event>, context: string) {
  const details = getInvalidEventIdentityDetails(event)
  const key = `${context}:${JSON.stringify(details)}`
  if (reportedInvalidEventIdentityKeys.has(key)) return
  if (reportedInvalidEventIdentityKeys.size > 5_000) reportedInvalidEventIdentityKeys.clear()
  reportedInvalidEventIdentityKeys.add(key)
  console.warn('[notify][email] skipping event without valid cursor identity', {
    context,
    ...details,
  })
}

function getInvalidEventIdentityDetails(event: PlainMessage<Event>) {
  if (event.data.case === 'newBlob') {
    const blob = event.data.value
    return {
      eventCase: event.data.case,
      account: event.account,
      blobType: blob?.blobType,
      cid: blob?.cid,
      resource: blob?.resource,
      blobId: blob?.blobId == null ? undefined : String(blob.blobId),
    }
  }
  if (event.data.case === 'newMention') {
    const mention = event.data.value
    return {
      eventCase: event.data.case,
      account: event.account,
      sourceBlobCid: mention?.sourceBlob?.cid,
      mentionType: mention?.mentionType,
      sourceType: mention?.sourceType,
      target: mention?.target,
      source: mention?.source,
    }
  }
  return {
    eventCase: event.data.case,
    account: event.account,
  }
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

/**
 * Returns whether an event falls outside the notification replay window.
 */
export function isNotificationEventTooOld(event: PlainMessage<Event>, nowMs: number = Date.now()): boolean {
  return getEventAtMs(event) < nowMs - notificationBackfillMaxAgeMs
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
  if (considerationTime && isNotificationEventTooOld(event)) {
    const eventId = getEventId(event) || 'unknown-event'
    if (!reportedOldEventIds.has(eventId)) {
      if (reportedOldEventIds.size > 5_000) reportedOldEventIds.clear()
      reportedOldEventIds.add(eventId)
      console.warn(`[notify][email] skip old event ${eventId} older than 1 hour`)
    }
    return
  }
  const eventId = getEventId(event)
  if (!eventId) {
    reportInvalidEventIdentity(event, 'evaluateEventForNotifications')
    return
  }
  const eventMeta: NotificationEventMeta = {
    eventId,
    eventAtMs: getEventAtMs(event),
  }
  logNotifDebug('evaluate event', {
    eventId: eventMeta.eventId,
    eventAtMs: eventMeta.eventAtMs,
    eventCase: event.data.case,
    account: event.account,
  })

  if (event.data.case === 'newMention') {
    logNotifVerbose('new mention event received', {
      eventId: eventMeta.eventId,
      eventAtMs: eventMeta.eventAtMs,
      account: event.account,
      target: event.data.value?.target,
      source: event.data.value?.source,
      sourceType: event.data.value?.sourceType,
      sourceBlobCid: event.data.value?.sourceBlob?.cid,
    })
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
    logNotifVerbose('new blob event received', {
      eventId: eventMeta.eventId,
      eventAtMs: eventMeta.eventAtMs,
      account: event.account,
      blobType: blob.blobType,
      cid: blob.cid,
    })
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
      if (!refEvent) return
      await evaluateDocUpdateForNotifications(refEvent, allSubscriptions, appendNotification)
      return
    }

    if (blob.blobType !== 'Comment') return

    const commentStartTime = Date.now()
    const serverComment = await grpcClient.comments.getComment({id: blob.cid})
    const commentTime = Date.now() - commentStartTime
    if (commentTime > 5000) {
      reportError(`Slow getComment: ${blob.cid} took ${commentTime}ms (threshold: 5000ms)`)
    }
    const rawComment = toPlainMessage(serverComment)
    const comment = HMCommentSchema.parse(rawComment)
    const blobCid = normalizeCidString(blob.cid)
    const includeMentionsFromBody = !blobCid || !options.mentionSourceBlobCids.has(blobCid)
    logNotifVerbose('comment blob loaded', {
      eventId: eventMeta.eventId,
      eventAtMs: eventMeta.eventAtMs,
      cid: blob.cid,
      commentId: comment.id,
      commentAuthor: comment.author,
      targetAccount: comment.targetAccount,
      targetPath: comment.targetPath ?? null,
      replyParent: comment.replyParent ?? null,
      threadRoot: comment.threadRoot ?? null,
      includeMentionsFromBody,
    })
    await evaluateNewCommentForNotifications(comment, allSubscriptions, appendNotification, eventMeta, {
      includeMentionsFromBody,
    })
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
      return normalizeSiteBaseUrl(accountResult.metadata?.siteUrl) || fallbackSiteBaseUrl
    }
  } catch (error: any) {
    reportError(`Error getting account site url ${accountId}: ${error.message}`)
  }
  return fallbackSiteBaseUrl
}

async function getAccountMetadata(accountId: string): Promise<HMMetadata | null> {
  try {
    const accountResult = await requestAPI('Account', accountId)
    return accountResult.type === 'account' ? accountResult.metadata : null
  } catch (error: any) {
    reportError(`Error getting account metadata ${accountId}: ${error.message}`)
    return null
  }
}

function normalizeSiteBaseUrl(siteUrl?: string | null): string | null {
  const normalized = siteUrl?.replace(/\/$/, '') || null
  return normalized || null
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
  const targetAccountUid = getMentionedAccountUid(targetId)
  if (!targetId || !targetAccountUid) {
    logNotifDebug('skip mention: target is not an account mention', {
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

  if (!targetMeta?.name && !sourceDocId.path?.length) {
    const sourceAccountMeta = await getAccountMetadata(sourceDocId.uid)
    if (sourceAccountMeta?.name) {
      targetMeta = {
        ...(targetMeta || {}),
        name: sourceAccountMeta.name,
      }
    }
  }

  const authorAccountId = mentionEvent.sourceBlob?.author || fallbackAuthorAccountId
  let authorMeta: HMMetadata | null = null
  try {
    const authorResult = await requestAPI('Account', authorAccountId)
    authorMeta = authorResult.type === 'account' ? authorResult.metadata : null
  } catch (error: any) {
    reportError(`Error getting mention author ${authorAccountId}: ${error.message}`)
  }

  let siteBaseUrl = normalizeSiteBaseUrl(targetMeta?.siteUrl)
  if (!siteBaseUrl) {
    siteBaseUrl = await getAccountSiteBaseUrl(sourceDocId.uid)
  }

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
    if (!sub.notifyAllMentions || sub.id !== targetAccountUid) continue
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

  const matchingSubscriptions = allSubscriptions.filter((sub) => sub.notifyAllMentions && sub.id === targetAccountUid)
  if (!matchingSubscriptions.length) {
    logNotifDebug('skip mention: no matching subscriptions', {
      eventId: eventMeta.eventId,
      targetAccountId: targetAccountUid,
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
  let commentAuthorUid = comment.author
  let targetMeta: HMMetadata | null = null
  let targetAuthorUids: string[] = []
  let targetDocumentSiteUrl: string | null = null
  let targetAccountSiteUrl: string | null = null
  const targetDocId = hmId(comment.targetAccount, {
    path: entityQueryPathToHmIdPath(comment.targetPath),
  })

  try {
    const resolvedAuthor = await resolveNotificationAccount((uid) => requestAPI('Account', uid), comment.author)
    commentAuthorUid = resolvedAuthor.uid
    commentAuthorMeta = resolvedAuthor.metadata
  } catch (error: any) {
    reportError(`Error getting comment author ${comment.author}: ${error.message}`)
  }

  try {
    const targetDocument = await getDocument(targetDocId)
    if (!targetDocument) return
    targetMeta = targetDocument.metadata || null
    targetAuthorUids = Array.isArray(targetDocument.authors)
      ? targetDocument.authors.filter((author): author is string => typeof author === 'string' && author.length > 0)
      : []
    targetDocumentSiteUrl = normalizeSiteBaseUrl(targetMeta?.siteUrl)
  } catch (error: any) {
    reportError(`Error getting target document for ${targetDocId.id}: ${error.message}`)
  }

  if (!targetMeta?.name && !targetDocId.path?.length) {
    const targetAccountMeta = await getAccountMetadata(comment.targetAccount)
    if (targetAccountMeta?.name) {
      targetMeta = {
        ...(targetMeta || {}),
        name: targetAccountMeta.name,
      }
    }
  }

  if (!targetDocumentSiteUrl) {
    try {
      const targetAccountResult = await requestAPI('Account', comment.targetAccount)
      if (targetAccountResult.type === 'account') {
        targetAccountSiteUrl = normalizeSiteBaseUrl(targetAccountResult.metadata?.siteUrl)
      }
    } catch (error: any) {
      reportError(`Error getting target account ${comment.targetAccount}: ${error.message}`)
    }
  }

  // Create comment-specific URL for comment-related notifications
  // Prefer the target document's siteUrl; fall back to account siteUrl, then default site base URL.
  const commentIdParts = comment.id.split('/')
  const commentTSID = commentIdParts[1]
  if (!commentTSID) {
    throw new Error('Invalid comment ID format: ' + comment.id)
  }
  const commentBaseUrl = targetDocumentSiteUrl || targetAccountSiteUrl || fallbackSiteBaseUrl
  const commentUrl = createWebHMUrl(comment.author, {
    path: [commentTSID],
    hostname: commentBaseUrl,
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
      if (parentComment?.author) {
        const resolvedParentAuthor = await resolveNotificationAccount(
          (uid) => requestAPI('Account', uid),
          parentComment.author,
        )
        parentCommentAuthor = resolvedParentAuthor.uid
      }
    } catch (error: any) {
      reportError(`Error getting parent comment ${comment.replyParent}: ${error.message}`)
    }
  }

  logNotifVerbose('evaluating comment notification candidates', {
    eventId: eventMeta.eventId,
    eventAtMs: eventMeta.eventAtMs,
    commentId: comment.id,
    commentAuthor: comment.author,
    targetAccount: comment.targetAccount,
    targetPath: comment.targetPath ?? null,
    targetAuthorUids,
    parentCommentAuthor,
    mentionedAccountUids: Array.from(mentionedUsers),
    candidateSubscriptions: allSubscriptions.length,
  })

  for (const sub of allSubscriptions) {
    const commentReason = classifyCommentNotificationForAccount({
      subscriptionAccountUid: sub.id,
      commentAuthorUid: commentAuthorUid,
      targetAccountUid: comment.targetAccount,
      targetAuthorUids,
      isTopLevelComment: !comment.threadRoot,
      parentCommentAuthorUid: parentCommentAuthor,
      mentionedAccountUids: mentionedUsers,
    })

    logNotifVerbose('comment notification candidate evaluated', {
      eventId: eventMeta.eventId,
      commentId: comment.id,
      subscriptionAccountId: sub.id,
      subscriptionEmail: sub.email,
      subscriptionSource: sub.source,
      shouldSendEmail: sub.shouldSendEmail,
      commentReason,
      notifyAllMentions: sub.notifyAllMentions,
      notifyAllReplies: sub.notifyAllReplies,
      notifyAllDiscussions: sub.notifyAllDiscussions,
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
    if (commentReason === 'discussion') {
      const discussionReason = getDiscussionNotificationReason(sub)
      if (!discussionReason) continue
      if (discussionReason === 'discussion') {
        await appendNotification(sub, {
          reason: 'discussion',
          comment: comment,
          parentComments: parentComments,
          authorMeta: commentAuthorMeta,
          targetMeta: targetMeta,
          targetId: targetDocId,
          url: commentUrl,
          eventId: eventMeta.eventId,
          eventAtMs: eventMeta.eventAtMs,
        })
      } else {
        await appendNotification(sub, {
          reason: 'site-new-discussion',
          comment: comment,
          parentComments: parentComments,
          authorMeta: commentAuthorMeta,
          targetMeta: targetMeta,
          targetId: targetDocId,
          url: commentUrl,
        })
      }
      logNotifDebug('discussion notification queued', {
        eventId: eventMeta.eventId,
        subscriptionAccountId: sub.id,
        subscriptionEmail: sub.email,
        reason: discussionReason,
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
  const lastProcessedEventId = getNewestEventId(events)
  if (!lastProcessedEventId) return
  console.log('Setting notifier last processed event ID to ' + lastProcessedEventId)
  setNotifierLastProcessedEventId(lastProcessedEventId)
}

function getNewestEventId(events: PlainMessage<Event>[]) {
  for (const event of events) {
    const eventId = getEventId(event)
    if (eventId) return eventId
  }
  return undefined
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
  if (!isValidEventCursorId(lastProcessedEventId)) {
    reportError(`Invalid notifier cursor "${lastProcessedEventId}". Skipping event load until cursor is reset.`)
    return {events: [], foundCursor: false, aborted: false}
  }

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
      if (!eventId) {
        reportInvalidEventIdentity(event, 'loadEventsAfterEventId')
        continue
      }
      if (matchesCursorEvent(event, eventId, lastProcessedEventId)) {
        const totalTime = Date.now() - startTime
        if (totalTime > 5000) {
          console.log(
            `loadEventsAfterEventId found target after ${pageCount} pages, ${eventsAfterEventId.length} events, ${totalTime}ms`,
          )
        }
        return {events: eventsAfterEventId, foundCursor: true, aborted: false}
      }
      eventsAfterEventId.push(event)
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
  if (!blob) {
    reportInvalidEventIdentity(event, 'loadRefEvent')
    return null
  }
  const refCid = normalizeCidString(blob.cid)
  if (!refCid) {
    reportInvalidEventIdentity(event, 'loadRefEvent')
    return null
  }
  const id = unpackHmId(blob.resource)

  if (!id?.uid) throw new Error('Invalid ref event for resource: ' + blob.resource)

  const refData = await loadRefFromIpfs(refCid)

  const changeCid = normalizeCidString(refData.heads?.[0]?.toString())
  if (!changeCid) return null

  const changeData = await loadRefFromIpfs(changeCid)

  const changedDoc = await getDocument(id)
  if (!changedDoc) return null

  const documentSiteUrl = normalizeSiteBaseUrl(changedDoc.metadata?.siteUrl)
  let accountSiteUrl: string | null = null
  if (!documentSiteUrl) {
    const homeAccountResult = await requestAPI('Account', id.uid)
    accountSiteUrl =
      homeAccountResult.type === 'account' ? normalizeSiteBaseUrl(homeAccountResult.metadata?.siteUrl) : null
  }
  const baseUrl = documentSiteUrl || accountSiteUrl || fallbackSiteBaseUrl

  const openUrl = createWebHMUrl(id.uid, {
    path: id.path,
    hostname: baseUrl,
  })

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
    if (!prevVersionDoc) return null
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
      if (annotation.type !== 'Embed') continue
      const mentionedAccountUid = getMentionedAccountUid(annotation.link)
      if (!mentionedAccountUid) continue
      mentionMap[block.id] = mentionMap[block.id] ?? new Set()
      mentionMap[block.id]!.add(mentionedAccountUid)
    }
  }
  if (children) extractMentionsFromBlockNodes(children, mentionMap)
}

// Timeout for IPFS fetches to prevent hanging when daemon is slow/unresponsive.
// Without this, a single slow/missing CID can block the entire notification system.
const IPFS_FETCH_TIMEOUT_MS = 5_000

async function loadRefFromIpfs(cid: string): Promise<any> {
  const normalizedCid = normalizeCidString(cid)
  if (!normalizedCid) throw new Error(`Invalid IPFS CID for ref fetch: ${String(cid)}`)

  const url = `${DAEMON_HTTP_URL}/ipfs/${normalizedCid}`

  // Use AbortController for fetch timeout since fetch() doesn't have native timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {signal: controller.signal})

    // Check HTTP status before attempting to decode - a 404/500 would cause CBOR decode errors
    if (!response.ok) {
      throw new Error(`IPFS fetch failed for CID ${normalizedCid}: HTTP ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return cborDecode(new Uint8Array(buffer))
  } catch (error: any) {
    // Convert AbortError to more descriptive timeout error
    if (error.name === 'AbortError') {
      throw new Error(`IPFS fetch timed out after ${IPFS_FETCH_TIMEOUT_MS}ms for CID ${normalizedCid}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
