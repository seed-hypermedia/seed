import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {createNotificationsEmail, Notification} from '@shm/emails/notifier'
import {
  createWebHMUrl,
  entityQueryPathToHmIdPath,
  Event,
  getAnnotations,
  HMBlockNode,
  HMBlockNodeSchema,
  HMComment,
  HMCommentSchema,
  HMDocument,
  hmId,
  HMMetadata,
  normalizeDate,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {DAEMON_HTTP_URL, SITE_BASE_URL} from '@shm/shared/constants'
import {CID} from 'multiformats'
import {
  BaseSubscription,
  getAllEmails,
  getBatchNotifierLastProcessedEventId,
  getBatchNotifierLastSendTime,
  getNotifierLastProcessedEventId,
  setBatchNotifierLastProcessedEventId,
  setBatchNotifierLastSendTime,
  setNotifierLastProcessedEventId,
} from './db'
import {sendEmail} from './mailer'
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

const notifReasonsImmediate = new Set<NotifReason>(['mention', 'reply'])
const notifReasonsBatch = new Set<NotifReason>([
  'site-doc-update',
  'site-new-discussion',
])

const adminEmail = process.env.SEED_DEV_ADMIN_EMAIL || 'eric@seedhypermedia.com'

// Error batching for reportError
const errorBatchDelayMs = 30_000 // 30 seconds
let pendingErrors: string[] = []
let errorBatchTimeout: ReturnType<typeof setTimeout> | null = null

function reportError(message: string) {
  const messageWithTime = `${new Date().toISOString()} ${message}`
  console.error(messageWithTime)
  pendingErrors.push(messageWithTime)

  if (!errorBatchTimeout) {
    errorBatchTimeout = setTimeout(flushErrorBatch, errorBatchDelayMs)
  }
}

async function flushErrorBatch() {
  errorBatchTimeout = null
  if (pendingErrors.length === 0) return

  const errors = pendingErrors
  pendingErrors = []

  const subject =
    errors.length === 1
      ? 'Email Notifier Error Report'
      : `Email Notifier Error Report (${errors.length} errors)`
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
      reportError(
        `Email notification processing timed out after ${timeoutMs}ms`,
      )
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
      reportError(
        `Batch notification processing timed out after ${timeoutMs}ms`,
      )
    }, timeoutMs)

    // Wait for the actual promise to settle (not just the timeout race)
    processingPromise
      .catch((err: Error) => {
        // Don't report abort errors - they're expected after timeout
        if (err.message !== 'Event loading aborted') {
          reportError(
            'Error handling batch email notifications: ' + err.message,
          )
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
    reportError(
      'No last event ID found. Verify connection to the daemon and make sure the activity api has events.',
    )
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
  const nextSendTime =
    lastSendTime.getTime() + emailBatchNotifIntervalHours * 60 * 60 * 1000
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
    console.log(
      `Next batch notifications will send in ${Math.round(
        (nextSendTime - nowTime) / 1000,
      )} seconds`,
    )
  }
}

async function handleEmailNotifications(signal?: AbortSignal) {
  const startTime = Date.now()
  const lastProcessedEventId = getNotifierLastProcessedEventId()
  if (lastProcessedEventId) {
    await handleImmediateNotificationsAfterEventId(lastProcessedEventId, signal)
    const elapsed = Date.now() - startTime
    if (elapsed > 10_000) {
      console.warn(`handleEmailNotifications took ${elapsed}ms`)
    }
  } else {
    reportError(
      'No last processed event ID found. Resetting last processed event ID',
    )
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
  const lastEventId = getEventId(event)
  if (!lastEventId) return
  return lastEventId
}

async function sendBatchNotifications(
  lastProcessedEventId: string,
  signal?: AbortSignal,
) {
  console.log('Sending batch notifications', lastProcessedEventId)
  const {events, foundCursor, aborted} = await loadEventsAfterEventId(
    lastProcessedEventId,
    signal,
  )
  console.log('Batch notifications events to process:', events.length)
  if (!foundCursor && !aborted) {
    // Cursor not found and not aborted - something is wrong with the feed
    console.warn('Batch: cursor not found in feed, processing available events')
  }
  if (events.length === 0) return
  await handleEmailNotifs(events, notifReasonsBatch)
}

async function resetNotifierLastProcessedEventId() {
  const lastEventId = await getLastEventId()
  if (!lastEventId) return
  reportError('Resetting notifier last processed event ID to ' + lastEventId)
  setNotifierLastProcessedEventId(lastEventId)
}

async function handleImmediateNotificationsAfterEventId(
  lastProcessedEventId: string,
  signal?: AbortSignal,
) {
  const startTime = Date.now()

  const {events, foundCursor, aborted} = await loadEventsAfterEventId(
    lastProcessedEventId,
    signal,
  )

  const loadTime = Date.now() - startTime
  if (loadTime > 5000) {
    console.warn(
      `loadEventsAfterEventId took ${loadTime}ms for ${events.length} events`,
    )
  }

  if (!foundCursor && !aborted && events.length > 0) {
    // Cursor not found but we have events - something is wrong
    // Still process events but log warning
    console.warn(
      'Immediate: cursor not found in feed, processing available events',
    )
  }

  if (events.length === 0) return

  const processStartTime = Date.now()
  try {
    await handleEmailNotifs(events, notifReasonsImmediate)
  } catch (error: any) {
    reportError('Error handling immediate notifications: ' + error.message)
  } finally {
    // even if there is an error, we still want to mark the events as processed.
    // so that we don't attempt to process the same events again.
    markEventsAsProcessed(events)

    const processTime = Date.now() - processStartTime
    if (processTime > 5000) {
      console.warn(
        `handleEmailNotifs took ${processTime}ms for ${events.length} events`,
      )
    }
  }
}

async function handleEmailNotifs(
  events: PlainMessage<Event>[],
  includedNotifReasons: Set<NotifReason>,
) {
  if (!events.length || !includedNotifReasons.size) return
  console.log(
    `Will handleEmailNotifs (${events.length} events): ${Array.from(
      includedNotifReasons,
    ).join(', ')}`,
  )
  const allEmailsIncludingUnsubscribed = getAllEmails()
  const allSubscribedEmails = allEmailsIncludingUnsubscribed.filter(
    (email) => !email.isUnsubscribed,
  )
  const allSubscriptions = deduplicateSubscriptions(
    allSubscribedEmails.flatMap((email) => email.subscriptions),
  )
  const notificationsToSend: Record<
    string, // email
    {
      accountId: string
      accountMeta: HMMetadata | null
      adminToken: string
      notif: Notification
    }[]
  > = {}
  const accountMetas: Record<string, HMMetadata | null> = {}
  async function appendNotification(
    subscription: BaseSubscription,
    notif: Notification,
  ) {
    const email = allEmailsIncludingUnsubscribed.find(
      (e) => e.email === subscription.email,
    )
    if (!email) return
    if (email.isUnsubscribed) return
    if (!includedNotifReasons.has(notif.reason)) return
    notificationsToSend[subscription.email] =
      notificationsToSend[subscription.email] ?? []
    notificationsToSend[subscription.email]!.push({
      accountId: subscription.id,
      adminToken: email.adminToken,
      accountMeta: accountMetas[subscription.id] || {},
      notif,
    })
  }

  for (const event of events) {
    const eventStartTime = Date.now()
    const eventId = getEventId(event)
    try {
      await evaluateEventForNotifications(
        event,
        allSubscriptions,
        appendNotification,
      )
    } catch (error: any) {
      reportError('Error evaluating event for notifications: ' + error.message)
    }
    const eventTime = Date.now() - eventStartTime
    if (eventTime > 5000) {
      reportError(
        `Slow event processing: ${eventId} took ${eventTime}ms (threshold: 5000ms)`,
      )
    }
  }
  const emailsToSend = Object.entries(notificationsToSend)
  for (const [email, notifications] of emailsToSend) {
    const firstNotification = notifications[0]
    if (!firstNotification) continue
    const adminToken = firstNotification.adminToken
    const notificationEmail = await createNotificationsEmail(
      email,
      {adminToken},
      notifications,
    )
    if (notificationEmail) {
      const {subject, text, html} = notificationEmail
      await sendEmail(email, subject, {text, html})
    }
  }
}

function getEventId(event: PlainMessage<Event>) {
  if (event.data.case === 'newBlob') {
    if (!event.data.value) return undefined
    return `blob-${event.data.value.cid}`
  }
  if (event.data.case === 'newMention') {
    if (!event.data.value) return undefined
    const {sourceBlob, mentionType, target} = event.data.value
    return `mention-${sourceBlob?.cid}-${mentionType}-${target}`
  }
  return undefined
}

async function evaluateEventForNotifications(
  event: PlainMessage<Event>,
  allSubscriptions: BaseSubscription[],
  appendNotification: (
    subscription: BaseSubscription,
    notif: Notification,
  ) => Promise<void>,
) {
  const eventTime = normalizeDate(event.eventTime)
  const observeTime = normalizeDate(event.observeTime)
  // the "consideration time" is the newest of the event time and the observe time
  const considerationTime =
    eventTime && observeTime
      ? Math.max(eventTime.getTime(), observeTime.getTime())
      : eventTime || observeTime
  // if the consideration time is older than the emailBatchNotifIntervalHours, we ignore it and print an error
  if (
    considerationTime &&
    considerationTime <
      new Date(Date.now() - emailBatchNotifIntervalHours * 60 * 60 * 1000)
  ) {
    const eventId = getEventId(event)
    reportError(
      `Event ${eventId} is older than ${emailBatchNotifIntervalHours} hours. Ignoring!`,
    )
    return
  }
  if (event.data.case === 'newBlob') {
    const blob = event.data.value
    if (blob.blobType === 'Ref') {
      const refStartTime = Date.now()
      const refEvent = await loadRefEvent(event)
      const refTime = Date.now() - refStartTime
      if (refTime > 5000) {
        reportError(
          `Slow loadRefEvent: ${blob.cid} took ${refTime}ms (threshold: 5000ms)`,
        )
      }
      await evaluateDocUpdateForNotifications(
        refEvent,
        allSubscriptions,
        appendNotification,
      )
    }
    if (blob.blobType === 'Comment') {
      const commentStartTime = Date.now()
      const serverComment = await grpcClient.comments.getComment({id: blob.cid})
      const commentTime = Date.now() - commentStartTime
      if (commentTime > 5000) {
        reportError(
          `Slow getComment: ${blob.cid} took ${commentTime}ms (threshold: 5000ms)`,
        )
      }
      const rawComment = toPlainMessage(serverComment)
      const comment = HMCommentSchema.parse(rawComment)
      await evaluateNewCommentForNotifications(
        comment,
        allSubscriptions,
        appendNotification,
      )
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
  allSubscriptions: BaseSubscription[],
  appendNotification: (
    subscription: BaseSubscription,
    notif: Notification,
  ) => Promise<void>,
) {
  for (const sub of allSubscriptions) {
    if (sub.notifyAllMentions && refEvent.newMentions[sub.id]) {
      const subjectAccountResult = await requestAPI('Account', sub.id)
      const subjectAccountMeta =
        subjectAccountResult.type === 'account'
          ? subjectAccountResult.metadata
          : null
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

async function evaluateNewCommentForNotifications(
  comment: HMComment,
  allSubscriptions: BaseSubscription[],
  appendNotification: (
    subscription: BaseSubscription,
    notif: Notification,
  ) => Promise<void>,
) {
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

  try {
    const authorResult = await requestAPI('Account', comment.author)
    commentAuthorMeta =
      authorResult.type === 'account' ? authorResult.metadata : null
  } catch (error: any) {
    reportError(
      `Error getting comment author ${comment.author}: ${error.message}`,
    )
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
    reportError(
      `Error getting target metadata for ${comment.targetAccount}: ${error.message}`,
    )
  }

  // Create comment-specific URL for comment-related notifications
  const commentIdParts = comment.id.split('/')
  const commentTSID = commentIdParts[1]
  if (!commentTSID) {
    throw new Error('Invalid comment ID format: ' + comment.id)
  }
  const commentUrl = createWebHMUrl(comment.author, {
    path: [commentTSID],
    hostname: SITE_BASE_URL.replace(/\/$/, ''),
  })

  const targetDocId = hmId(comment.targetAccount, {
    path: entityQueryPathToHmIdPath(comment.targetPath),
  })

  // Get all mentioned users in this comment
  const mentionedUsers = new Set<string>()
  for (const rawBlockNode of comment.content) {
    const blockNode = HMBlockNodeSchema.parse(rawBlockNode)
    // @ts-expect-error
    for (const annotation of blockNode.block?.annotations || []) {
      if (annotation.type === 'Embed') {
        const hmId = unpackHmId(annotation.link)
        if (hmId && !hmId.path?.length) {
          mentionedUsers.add(hmId.uid)
        }
      }
    }
  }

  // Get the parent comment author for reply notifications
  let parentCommentAuthor: string | null = null
  if (comment.replyParent) {
    try {
      const parentComment = await requestAPI('Comment', comment.replyParent)
      if (parentComment) {
        parentCommentAuthor = parentComment.author
      }
    } catch (error: any) {
      reportError(
        `Error getting parent comment ${comment.replyParent}: ${error.message}`,
      )
    }
  }

  for (const sub of allSubscriptions) {
    if (sub.notifyAllMentions && mentionedUsers.has(sub.id)) {
      const subjectAccountResult = await requestAPI('Account', sub.id)
      if (subjectAccountResult.type !== 'account') {
        throw new Error(`Error getting subject account meta for ${sub.id}`)
      }
      appendNotification(sub, {
        reason: 'mention',
        source: 'comment',
        authorAccountId: comment.author,
        authorMeta: commentAuthorMeta,
        targetMeta: targetMeta,
        targetId: targetDocId,
        url: commentUrl,
        subjectAccountId: sub.id,
        subjectAccountMeta: subjectAccountResult.metadata,
      })
    }
    if (sub.notifyAllReplies && parentCommentAuthor === sub.id) {
      appendNotification(sub, {
        reason: 'reply',
        comment: comment,
        parentComments: parentComments,
        authorMeta: commentAuthorMeta,
        targetMeta: targetMeta,
        targetId: targetDocId,
        url: commentUrl,
      })
    }
    if (
      sub.id === comment.targetAccount &&
      !comment.threadRoot &&
      sub.notifySiteDiscussions
    ) {
      appendNotification(sub, {
        reason: 'site-new-discussion',
        comment: comment,
        parentComments: parentComments,
        authorMeta: commentAuthorMeta,
        targetMeta: targetMeta,
        targetId: targetDocId,
        url: commentUrl,
      })
    }
    if (sub.notifyAllComments && sub.id === comment.author) {
      appendNotification(sub, {
        reason: 'user-comment',
        comment: comment,
        parentComments: parentComments,
        authorMeta: commentAuthorMeta,
        targetMeta: targetMeta,
        targetId: targetDocId,
        url: commentUrl,
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
      if (
        error?.code === 'not_found' ||
        error?.message?.includes('not found')
      ) {
        console.warn(
          `Parent comment ${currentComment.replyParent} not found, stopping parent traversal`,
        )
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
  console.log(
    'Setting notifier last processed event ID to ' + lastProcessedEventId,
  )
  setNotifierLastProcessedEventId(lastProcessedEventId)
}

// Maximum pages to fetch when looking for lastProcessedEventId
// This prevents infinite loops if the event ID is no longer in the feed
const MAX_EVENT_PAGES = 100
const EVENT_PAGE_SIZE = 20

// Timeout for individual gRPC calls to prevent hanging
const GRPC_CALL_TIMEOUT_MS = 10_000

async function withGrpcTimeout<T>(
  promise: Promise<T>,
  operationName: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new Error(
            `${operationName} timed out after ${GRPC_CALL_TIMEOUT_MS}ms`,
          ),
        ),
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

async function loadEventsAfterEventId(
  lastProcessedEventId: string,
  signal?: AbortSignal,
): Promise<LoadEventsResult> {
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
      reportError(
        `Slow gRPC call: listEvents page ${pageCount} took ${pageTime}ms (threshold: 5000ms)`,
      )
    } else if (pageTime > 1000) {
      console.warn(
        `loadEventsAfterEventId page ${pageCount} took ${pageTime}ms (${events.length} events)`,
      )
    }

    for (const event of events) {
      const eventId = getEventId(event)
      if (eventId) {
        if (eventId === lastProcessedEventId) {
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
  if (event.data.case !== 'newBlob')
    throw new Error('Invalid event for loadRefEvent')
  const blob = event.data.value
  const id = unpackHmId(blob.resource)

  if (!id?.uid)
    throw new Error('Invalid ref event for resource: ' + blob.resource)

  const refData = await loadRefFromIpfs(blob.cid)

  const changeCid = refData.heads?.[0]?.toString()

  const changeData = await loadRefFromIpfs(changeCid)

  const changedDoc = await getDocument(id)

  const openUrl = `${SITE_BASE_URL.replace(/\/$/, '')}/hm/${id.uid}/${(
    id.path || []
  ).join('/')}`

  const prevVersionId = {
    ...id,
    version:
      changeData.deps && changeData.deps.length > 0
        ? changeData.deps.map((cid: CID) => cid.toString()).join('.')
        : null,
  }

  const isNewDocument =
    Array.isArray(changeData.deps) && changeData.deps.length === 0

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
        const addedMentions = new Set(
          Array.from(mentions).filter((m) => !prevMentions.has(m)),
        )
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

function extractMentionsFromBlockNodes(
  content: HMBlockNode[],
  mentionMap: MentionMap,
) {
  for (const blockNode of content) {
    extractMentionsFromBlockNode(blockNode, mentionMap)
  }
}

function extractMentionsFromBlockNode(
  blockNode: HMBlockNode,
  mentionMap: MentionMap,
) {
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
      throw new Error(
        `IPFS fetch failed for CID ${cid}: HTTP ${response.status} ${response.statusText}`,
      )
    }

    const buffer = await response.arrayBuffer()
    return cborDecode(new Uint8Array(buffer))
  } catch (error: any) {
    // Convert AbortError to more descriptive timeout error
    if (error.name === 'AbortError') {
      throw new Error(
        `IPFS fetch timed out after ${IPFS_FETCH_TIMEOUT_MS}ms for CID ${cid}`,
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function deduplicateSubscriptions(
  subscriptions: BaseSubscription[],
): BaseSubscription[] {
  const deduplicatedMap = new Map<string, BaseSubscription>()

  for (const subscription of subscriptions) {
    const key = `${subscription.id}:${subscription.email}`
    const existing = deduplicatedMap.get(key)

    if (existing) {
      // Aggregate notification settings using logical OR
      deduplicatedMap.set(key, {
        ...existing,
        notifyAllMentions:
          existing.notifyAllMentions || subscription.notifyAllMentions,
        notifyAllReplies:
          existing.notifyAllReplies || subscription.notifyAllReplies,
        notifyOwnedDocChange:
          existing.notifyOwnedDocChange || subscription.notifyOwnedDocChange,
        notifySiteDiscussions:
          existing.notifySiteDiscussions || subscription.notifySiteDiscussions,
        notifyAllComments:
          existing.notifyAllComments || subscription.notifyAllComments,
      })
    } else {
      deduplicatedMap.set(key, subscription)
    }
  }

  return Array.from(deduplicatedMap.values())
}
