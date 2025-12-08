import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {createNotificationsEmail, Notification} from '@shm/emails/notifier'
import {
  abbreviateUid,
  BlockNode,
  createWebHMUrl,
  entityQueryPathToHmIdPath,
  Event,
  getAnnotations,
  HMBlockNode,
  HMBlockNodeSchema,
  HMComment,
  HMCommentSchema,
  HMDocument,
  HMDocumentMetadataSchema,
  hmId,
  HMMetadata,
  HMMetadataPayload,
  normalizeDate,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {DAEMON_HTTP_URL, SITE_BASE_URL} from '@shm/shared/constants'
import {CID} from 'multiformats'
import {grpcClient} from './client.server'
import {
  BaseSubscription,
  getAllEmails,
  getBatchNotifierLastProcessedBlobCid,
  getBatchNotifierLastSendTime,
  getNotifierLastProcessedBlobCid,
  setBatchNotifierLastProcessedBlobCid,
  setBatchNotifierLastSendTime,
  setNotifierLastProcessedBlobCid,
} from './db'
import {getAccount, getComment, getDocument, getMetadata} from './loaders'
import {sendEmail} from './mailer'

let currentNotifProcessing: Promise<void> | undefined = undefined
let currentBatchNotifProcessing: Promise<void> | undefined = undefined

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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise])
}

export async function initEmailNotifier() {
  console.log('Init Email Notifier')

  currentNotifProcessing = handleEmailNotifications()
  await currentNotifProcessing
  currentNotifProcessing.finally(() => {
    currentNotifProcessing = undefined
  })

  setInterval(() => {
    if (currentNotifProcessing) {
      reportError('Email notifications already processing. Skipping round.')
      return
    }
    const timeoutMs = 60_000 // 60 seconds max
    currentNotifProcessing = withTimeout(
      handleEmailNotifications(),
      timeoutMs,
      `Email notification processing timed out after ${timeoutMs}ms`,
    )

    currentNotifProcessing
      .then(() => {
        // console.log('Email notifications handled')
      })
      .catch((err: Error) => {
        reportError('Error handling email notifications: ' + err.message)
      })
      .finally(() => {
        currentNotifProcessing = undefined
      })
  }, 1000 * handleImmediateEmailNotificationsIntervalSeconds)

  setInterval(() => {
    if (currentBatchNotifProcessing) return
    const timeoutMs = 120_000 // 120 seconds max for batch processing
    currentBatchNotifProcessing = withTimeout(
      handleBatchNotifications(),
      timeoutMs,
      `Batch notification processing timed out after ${timeoutMs}ms`,
    )
    currentBatchNotifProcessing
      .then(() => {
        // console.log('Batch email notifications handled')
      })
      .catch((err: Error) => {
        reportError('Error handling batch email notifications: ' + err.message)
      })
      .finally(() => {
        currentBatchNotifProcessing = undefined
      })
  }, 30_000)
}

async function handleBatchNotifications() {
  const lastSendTime = getBatchNotifierLastSendTime()
  const lastProcessedBlobCid = getBatchNotifierLastProcessedBlobCid()
  const lastBlobCid = await getLastEventBlobCid()
  if (!lastBlobCid) {
    reportError(
      'No last blob CID found. Verify connection to the daemon and make sure the activity api has events.',
    )
    return
  }
  if (!lastSendTime || !lastProcessedBlobCid) {
    const resetTime = new Date()
    // we refuse to send all notifications for the whole historical feed. so if we haven't sent any notifications yet, we will do so after the first interval elapses
    reportError(
      'Batch notifier missing cursor values. Setting initial: ' +
        JSON.stringify({
          resetTime: resetTime.toISOString(),
          lastBlobCid,
        }),
    )
    setBatchNotifierLastSendTime(resetTime)
    setBatchNotifierLastProcessedBlobCid(lastBlobCid)
    return
  }
  const nowTime = Date.now()
  const nextSendTime =
    lastSendTime.getTime() + emailBatchNotifIntervalHours * 60 * 60 * 1000
  if (nextSendTime < nowTime) {
    try {
      await sendBatchNotifications(lastProcessedBlobCid)
    } catch (error: any) {
      reportError('Error sending batch notifications: ' + error.message)
    } finally {
      // even if there is an error, we still want to mark the events as processed.
      // so that we don't attempt to process the same events again.
      setBatchNotifierLastSendTime(new Date())
      setBatchNotifierLastProcessedBlobCid(lastBlobCid)
    }
  } else {
    console.log(
      `Next batch notifications will send in ${Math.round(
        (nextSendTime - nowTime) / 1000,
      )} seconds`,
    )
  }
}

async function handleEmailNotifications() {
  const lastProcessedBlobCid = getNotifierLastProcessedBlobCid()
  if (lastProcessedBlobCid) {
    await handleImmediateNotificationsAfterBlobCid(lastProcessedBlobCid)
  } else {
    reportError(
      'No last processed blob CID found. Resetting last processed blob CID',
    )
    await resetNotifierLastProcessedBlobCid()
  }
}

async function getLastEventBlobCid(): Promise<string | undefined> {
  const {events} = await grpcClient.activityFeed.listEvents({
    pageToken: undefined,
    pageSize: 5,
  })
  const event = events.at(0)
  if (!event) return
  const lastBlobCid =
    event.data.case === 'newBlob'
      ? event.data.value?.cid
      : event.data.case === 'newMention'
      ? event.data.value?.sourceBlob?.cid
      : undefined
  if (!lastBlobCid) return
  return lastBlobCid
}

async function sendBatchNotifications(lastProcessedBlobCid: string) {
  console.log('Sending batch notifications', lastProcessedBlobCid)
  const eventsToProcess = await loadEventsAfterBlobCid(lastProcessedBlobCid)
  console.log('Batch notifications events to process:', eventsToProcess.length)
  if (eventsToProcess.length === 0) return
  await handleEmailNotifs(eventsToProcess, notifReasonsBatch)
}

async function resetNotifierLastProcessedBlobCid() {
  const lastBlobCid = await getLastEventBlobCid()
  reportError('Resetting notifier last processed blob CID to ' + lastBlobCid)
  if (!lastBlobCid) return
  setNotifierLastProcessedBlobCid(lastBlobCid)
}

async function handleImmediateNotificationsAfterBlobCid(
  lastProcessedBlobCid: string,
) {
  const eventsToProcess = await loadEventsAfterBlobCid(lastProcessedBlobCid)
  if (eventsToProcess.length === 0) return
  try {
    await handleEmailNotifs(eventsToProcess, notifReasonsImmediate)
  } catch (error: any) {
    reportError('Error handling immediate notifications: ' + error.message)
  } finally {
    // even if there is an error, we still want to mark the events as processed.
    // so that we don't attempt to process the same events again.
    await markEventsAsProcessed(eventsToProcess)
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
    try {
      await evaluateEventForNotifications(
        event,
        allSubscriptions,
        appendNotification,
      )
    } catch (error: any) {
      reportError('Error evaluating event for notifications: ' + error.message)
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
    // const eventId = event.data.case === 'newBlob' ? event.data.value?.cid : event.data.case === 'newMention' ? event.data.value?.
    reportError(
      `Event ${getEventId(
        event,
      )} is older than ${emailBatchNotifIntervalHours} hours. Ignoring!`,
    )
    return
  }
  if (event.data.case === 'newBlob') {
    const blob = event.data.value
    if (blob.blobType === 'Ref') {
      const refEvent = await loadRefEvent(event)
      await evaluateDocUpdateForNotifications(
        refEvent,
        allSubscriptions,
        appendNotification,
      )
    }
    if (blob.blobType === 'Comment') {
      const serverComment = await grpcClient.comments.getComment({id: blob.cid})
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
      const subjectAccountMeta = (await getAccount(sub.id)).metadata
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
  const parentComments = await getParentComments(comment)
  let commentAuthorMeta = null
  let targetMeta = null

  try {
    commentAuthorMeta = (await getAccount(comment.author)).metadata
  } catch (error: any) {
    reportError(
      `Error getting comment author ${comment.author}: ${error.message}`,
    )
  }

  try {
    targetMeta = (
      await getMetadata(
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
      const parentComment = await getComment(comment.replyParent)
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
      const subjectAccountMeta = await getAccount(sub.id)
      if (!subjectAccountMeta) {
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
        subjectAccountMeta: subjectAccountMeta.metadata,
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

// function getMentions(comment: PlainMessage<Comment>) {
//   const allMentions = new Set<string>()
//   comment.content.forEach((rawBlockNode) => {
//     const blockNode = HMBlockNodeSchema.parse(rawBlockNode)
//     const mentions = getBlockNodeMentions(blockNode)
//     for (const mention of mentions) {
//       allMentions.add(mention)
//     }
//   })
//   return allMentions
// }

// function getBlockNodeMentions(blockNode: HMBlockNode): Set<string> {
//   const mentions: Set<string> = new Set()
//   // @ts-expect-error
//   for (const annotation of blockNode.block?.annotations || []) {
//     if (annotation.type === 'Embed') {
//       const hmId = unpackHmId(annotation.link)
//       if (hmId && !hmId.path?.length) {
//         mentions.add(hmId.uid)
//       }
//     }
//   }
//   return mentions
// }

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

async function markEventsAsProcessed(events: PlainMessage<Event>[]) {
  const newestEvent = events.at(0)
  if (!newestEvent) return
  const lastProcessedBlobCid =
    newestEvent.data.case === 'newBlob'
      ? newestEvent.data.value?.cid
      : newestEvent.data.case === 'newMention'
      ? newestEvent.data.value?.sourceBlob?.cid
      : undefined
  if (!lastProcessedBlobCid) return
  reportError(
    'Setting notifier last processed blob CID to ' + lastProcessedBlobCid,
  )
  await setNotifierLastProcessedBlobCid(lastProcessedBlobCid)
}

async function loadEventsAfterBlobCid(lastProcessedBlobCid: string) {
  const eventsAfterBlobCid = []
  let currentPageToken: string | undefined

  while (true) {
    const {events, nextPageToken} = await grpcClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: 2,
    })

    for (const event of events) {
      const eventCid =
        event.data.case === 'newBlob'
          ? event.data.value?.cid
          : event.data.case === 'newMention'
          ? event.data.value?.sourceBlob?.cid
          : undefined

      if (eventCid) {
        if (eventCid === lastProcessedBlobCid) {
          return eventsAfterBlobCid
        }
        eventsAfterBlobCid.push(toPlainMessage(event))
      }
    }

    if (!nextPageToken) break
    currentPageToken = nextPageToken
  }

  return eventsAfterBlobCid
}

async function resolveAccount(accountId: string) {
  const account = await grpcClient.documents.getAccount({id: accountId})
  if (account.aliasAccount) {
    return await resolveAccount(account.aliasAccount)
  }
  const result: HMMetadataPayload = {
    id: hmId(accountId),
    metadata: HMDocumentMetadataSchema.parse(account.metadata),
  }
  return result
}

async function resolveAnnotationNames(blocks: BlockNode[]) {
  const resolvedNames: Record<string, string> = {}

  for (const block of blocks) {
    const blockNode = HMBlockNodeSchema.parse(block)
    // @ts-expect-error
    for (const annotation of blockNode.block?.annotations || []) {
      if (annotation.type === 'Embed' && annotation.link) {
        const unpacked = unpackHmId(annotation.link)

        if (unpacked) {
          const isAccountLink = !unpacked.path || unpacked.path.length === 0

          try {
            if (isAccountLink) {
              const account = await getAccount(unpacked.uid)
              resolvedNames[annotation.link] = account.metadata?.name
                ? account.metadata?.name
                : `@${abbreviateUid(unpacked.uid)}`
            } else {
              const meta = await getMetadata(unpacked)
              resolvedNames[annotation.link] = meta.metadata?.name
                ? meta.metadata?.name
                : `@${abbreviateUid(unpacked.uid)}`
            }
          } catch {
            resolvedNames[annotation.link] = `@${abbreviateUid(unpacked.uid)}`
          }
        }
      }
    }
  }

  return resolvedNames
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
  const authorMeta = (await getAccount(blob.author)).metadata
  if (!authorMeta)
    throw new Error('Error getting author meta for ' + blob.author)
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

async function loadRefFromIpfs(cid: string): Promise<any> {
  const url = `${DAEMON_HTTP_URL}/ipfs/${cid}`
  const buffer = await fetch(url).then((res) => res.arrayBuffer())
  return cborDecode(new Uint8Array(buffer))
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
