import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {createNotificationsEmail, Notification} from '@shm/emails/notifier'
import {
  Comment,
  ENABLE_EMAIL_NOTIFICATIONS,
  entityQueryPathToHmIdPath,
  Event,
  HMBlockNode,
  HMBlockNodeSchema,
  HMDocumentMetadataSchema,
  hmId,
  HMMetadata,
  HMMetadataPayload,
  SITE_BASE_URL,
  unpackHmId,
} from '@shm/shared'
import {queryClient} from './client'
import {
  getAllEmails,
  getNotifierLastProcessedBlobCid,
  setNotifierLastProcessedBlobCid,
} from './db'
import {getMetadata} from './loaders'
import {sendEmail} from './mailer'

export async function initEmailNotifier() {
  if (!ENABLE_EMAIL_NOTIFICATIONS) return
  console.log('Email Notifications Enabled')

  await handleEmailNotifications()

  const handleEmailNotificationsIntervalSeconds = 30

  setInterval(() => {
    handleEmailNotifications()
      .then(() => {
        // console.log('Email notifications handled')
      })
      .catch((err) => {
        console.error('Error handling email notifications', err)
      })
  }, 1000 * handleEmailNotificationsIntervalSeconds)
}

async function handleEmailNotifications() {
  const lastProcessedBlobCid = getNotifierLastProcessedBlobCid()
  if (lastProcessedBlobCid) {
    await handleEmailNotificationsAfterBlobCid(lastProcessedBlobCid)
  } else {
    await resetNotifierLastProcessedBlobCid()
  }
}

async function resetNotifierLastProcessedBlobCid() {
  const {events} = await queryClient.activityFeed.listEvents({
    pageToken: undefined,
    pageSize: 5,
  })
  const event = events.at(0)
  if (!event) return
  const lastBlobCid =
    event.data.case === 'newBlob' && event.data.value?.cid
      ? event.data.value.cid
      : undefined
  if (!lastBlobCid) return
  setNotifierLastProcessedBlobCid(lastBlobCid)
}

async function handleEmailNotificationsAfterBlobCid(
  lastProcessedBlobCid: string,
) {
  const eventsToProcess = await loadEventsAfterBlobCid(lastProcessedBlobCid)
  if (eventsToProcess.length === 0) return
  await handleEventsForEmailNotifications(eventsToProcess)
  await markEventsAsProcessed(eventsToProcess)
}

async function handleEventsForEmailNotifications(
  events: PlainMessage<Event>[],
) {
  console.log('handleEventsForEmailNotifications', events.length)
  const allEmails = getAllEmails()
  const accountNotificationOptions: Record<
    string,
    {
      notifyAllMentions: boolean
      notifyAllReplies: boolean
      email: string
    }
  > = {}
  const emailOptions: Record<
    string, // email
    {
      adminToken: string
      isUnsubscribed: boolean
      createdAt: string
    }
  > = {}
  for (const email of allEmails) {
    emailOptions[email.email] = {
      adminToken: email.adminToken,
      isUnsubscribed: email.isUnsubscribed,
      createdAt: email.createdAt,
    }
  }
  const notificationsToSend: Record<
    string, // email
    {
      accountId: string
      accountMeta: HMMetadata | null
      notif: Notification
    }[]
  > = {}
  const accountMetas: Record<string, HMMetadata | null> = {}
  async function appendNotification(
    email: string,
    accountId: string,
    notif: Notification,
  ) {
    if (!notificationsToSend[email]) {
      notificationsToSend[email] = []
    }
    if (accountMetas[accountId] === undefined) {
      accountMetas[accountId] = (
        await getMetadata(hmId('d', accountId))
      ).metadata
    }
    notificationsToSend[email].push({
      accountId,
      accountMeta: accountMetas[accountId],
      notif,
    })
  }
  for (const email of allEmails) {
    for (const account of email.accounts) {
      const opts = emailOptions[email.email]
      if (opts.isUnsubscribed) continue
      accountNotificationOptions[account.id] = {
        notifyAllMentions: account.notifyAllMentions,
        notifyAllReplies: account.notifyAllReplies,
        email: email.email,
      }
    }
  }
  const newComments: {
    comment: PlainMessage<Comment>
    parentAuthors: Set<string>
    parentComments: PlainMessage<Comment>[]
    commentAuthorMeta: HMMetadata | null
    targetMeta: HMMetadata | null
    mentions: Set<string>
  }[] = []
  for (const event of events) {
    if (event.data.case === 'newBlob') {
      try {
        const blob = event.data.value
        if (blob.blobType !== 'Comment') continue
        const comment = await queryClient.comments.getComment({id: blob.cid})
        const parentComments = await getParentComments(comment)
        const parentAuthors: Set<string> = new Set()
        for (const parentComment of parentComments) {
          parentAuthors.add(parentComment.author)
        }
        const resolvedParentAuthors: Set<string> = new Set()
        for (const parentAuthor of parentAuthors) {
          try {
            const account = await resolveAccount(parentAuthor)
            resolvedParentAuthors.add(account.id.uid)
          } catch (e) {
            console.error(
              'Error resolving parent author',
              parentAuthor,
              `when processing event id ipfs://${event.data.value?.cid}`,
              e,
            )
          }
        }
        const explicitMentions = getMentions(comment)
        const mentions: Set<string> = new Set()
        for (const mentionedAuthor of explicitMentions) {
          try {
            const account = await resolveAccount(mentionedAuthor)
            mentions.add(account.id.uid)
          } catch (e) {
            console.error(
              'Error resolving mentioned author',
              mentionedAuthor,
              `when processing event id ipfs://${event.data.value?.cid}`,
              e,
            )
          }
        }
        newComments.push({
          comment: toPlainMessage(comment),
          parentComments,
          parentAuthors: resolvedParentAuthors,
          commentAuthorMeta: (await getMetadata(hmId('d', comment.author)))
            .metadata,
          targetMeta: (
            await getMetadata(
              hmId('d', comment.targetAccount, {
                path: entityQueryPathToHmIdPath(comment.targetPath),
              }),
            )
          ).metadata,
          mentions,
        })
      } catch (e) {
        console.error('Failed to process event', event, e)
      }
    }
  }
  for (const newComment of newComments) {
    for (const accountId in accountNotificationOptions) {
      if (newComment.comment.author === accountId) continue // don't notify the author for their own comments
      const account = accountNotificationOptions[accountId]
      const comment = newComment.comment
      const targetDocUrl = `${SITE_BASE_URL}/hm/${comment.targetAccount}${comment.targetPath}`
      const targetDocId = hmId('d', comment.targetAccount, {
        path: entityQueryPathToHmIdPath(comment.targetPath),
      })
      if (account.notifyAllReplies && newComment.parentAuthors.has(accountId)) {
        await appendNotification(account.email, accountId, {
          type: 'reply',
          comment: newComment.comment,
          parentComments: newComment.parentComments,
          commentAuthorMeta: newComment.commentAuthorMeta,
          targetMeta: newComment.targetMeta,
          targetId: targetDocId,
          url: targetDocUrl,
        })
      }
      if (account.notifyAllMentions) {
        if (newComment.mentions.has(accountId)) {
          const resolvedNames = await resolveAnnotationNames(newComment.comment)
          await appendNotification(account.email, accountId, {
            type: 'mention',
            comment: newComment.comment,
            parentComments: newComment.parentComments,
            commentAuthorMeta: newComment.commentAuthorMeta,
            targetMeta: newComment.targetMeta,
            targetId: targetDocId,
            url: targetDocUrl,
            resolvedNames,
          })
        }
      }
    }
  }
  const emailsToSend = Object.entries(notificationsToSend)
  for (const [email, notifications] of emailsToSend) {
    const opts = emailOptions[email]
    if (opts.isUnsubscribed) continue
    const notificationEmail = await createNotificationsEmail(
      email,
      opts,
      notifications,
    )
    if (notificationEmail) {
      const {subject, text, html} = notificationEmail
      await sendEmail(email, subject, {text, html})
    }
  }
}

function getMentions(comment: PlainMessage<Comment>) {
  const allMentions = new Set<string>()
  comment.content.forEach((rawBlockNode) => {
    const blockNode = HMBlockNodeSchema.parse(rawBlockNode)
    const mentions = getBlockNodeMentions(blockNode)
    for (const mention of mentions) {
      allMentions.add(mention)
    }
  })
  return allMentions
}

function getBlockNodeMentions(blockNode: HMBlockNode): Set<string> {
  const mentions: Set<string> = new Set()
  for (const annotation of blockNode.block?.annotations || []) {
    if (annotation.type === 'Embed') {
      const hmId = unpackHmId(annotation.link)
      if (hmId && !hmId.path?.length) {
        mentions.add(hmId.uid)
      }
    }
  }
  return mentions
}

async function getParentComments(comment: PlainMessage<Comment>) {
  const parentComments: PlainMessage<Comment>[] = []
  let currentComment = comment
  while (currentComment.replyParent) {
    const parentComment = await queryClient.comments.getComment({
      id: currentComment.replyParent,
    })
    const parentCommentPlain = toPlainMessage(parentComment)
    parentComments.push(parentCommentPlain)
    currentComment = parentCommentPlain
  }
  return parentComments
}

// to load change cid:
//   queryClient.entities.getChange({
//     id:
//   })

async function markEventsAsProcessed(events: PlainMessage<Event>[]) {
  const newestEvent = events.at(0)
  if (!newestEvent) return
  const lastProcessedBlobCid = newestEvent.data.value?.cid
  if (!lastProcessedBlobCid) return
  await setNotifierLastProcessedBlobCid(lastProcessedBlobCid)
}

async function loadEventsAfterBlobCid(lastProcessedBlobCid: string) {
  const eventsAfterBlobCid = []
  let currentPageToken: string | undefined

  while (true) {
    const {events, nextPageToken} = await queryClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: 2,
    })

    for (const event of events) {
      if (event.data.case === 'newBlob' && event.data.value?.cid) {
        if (event.data.value.cid === lastProcessedBlobCid) {
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
  const account = await queryClient.documents.getAccount({id: accountId})
  if (account.aliasAccount) {
    return await resolveAccount(account.aliasAccount)
  }
  const result: HMMetadataPayload = {
    id: hmId('d', accountId),
    metadata: HMDocumentMetadataSchema.parse(account.metadata),
  }
  return result
}

async function resolveAnnotationNames(comment: PlainMessage<Comment>) {
  const resolvedNames: Record<string, string> = {}

  for (const block of comment.content) {
    const node = HMBlockNodeSchema.parse(block)
    for (const annotation of node.block?.annotations || []) {
      if (annotation.type === 'Embed' && annotation.link) {
        const unpacked = unpackHmId(annotation.link)
        if (unpacked) {
          try {
            const meta = await getMetadata(unpacked)
            resolvedNames[annotation.link] = meta.metadata?.name || '@unknown'
          } catch {
            resolvedNames[annotation.link] = '@unknown'
          }
        }
      }
    }
  }

  return resolvedNames
}
