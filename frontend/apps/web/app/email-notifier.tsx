import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {createNotificationsEmail, Notification} from '@shm/emails/notifier'
import {
  Annotation,
  BlockNode,
  Comment,
  entityQueryPathToHmIdPath,
  Event,
  HMBlockNode,
  HMBlockNodeSchema,
  HMDocumentMetadataSchema,
  hmId,
  HMLoadedBlock,
  HMMetadata,
  HMMetadataPayload,
  unpackHmId,
} from '@shm/shared'
import {
  DAEMON_HTTP_URL,
  ENABLE_EMAIL_NOTIFICATIONS,
  SITE_BASE_URL,
} from '@shm/shared/constants'
// import {CID} from 'multiformats/cid'
import {grpcClient} from './client.server'
import {
  getAllEmails,
  getNotifierLastProcessedBlobCid,
  setNotifierLastProcessedBlobCid,
} from './db'
import {getAccount, getDocument, getMetadata} from './loaders'
import {sendEmail} from './mailer'

export async function initEmailNotifier() {
  if (!ENABLE_EMAIL_NOTIFICATIONS) return
  console.log('Email Notifications Enabled')

  await handleEmailNotifications()

  const handleEmailNotificationsIntervalSeconds = 10

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
  console.log(
    '~~ handleEmailNotifications lastProcessedBlobCid',
    lastProcessedBlobCid,
  )
  if (lastProcessedBlobCid) {
    await handleEmailNotificationsAfterBlobCid(lastProcessedBlobCid)
  } else {
    await resetNotifierLastProcessedBlobCid()
  }
}

async function resetNotifierLastProcessedBlobCid() {
  const {events} = await grpcClient.activityFeed.listEvents({
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
  console.log(
    '~~ handleEmailNotificationsAfterBlobCid eventsToProcess',
    eventsToProcess.length,
  )
  if (eventsToProcess.length === 0) return
  await handleEventsForEmailNotifications(eventsToProcess)
  await markEventsAsProcessed(eventsToProcess)
}

async function handleEventsForEmailNotifications(
  events: PlainMessage<Event>[],
) {
  console.log('~~ handleEventsForEmailNotifications', events.length)
  const allEmails = getAllEmails()
  const accountNotificationOptions: Record<
    string,
    {
      notifyAllMentions: boolean
      notifyAllReplies: boolean
      notifyOwnedDocChange: boolean
      notifySiteDiscussions: boolean
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
      accountMetas[accountId] = (await getAccount(accountId)).metadata
    }
    notificationsToSend[email].push({
      accountId,
      accountMeta: accountMetas[accountId],
      notif,
    })
  }
  for (const email of allEmails) {
    for (const account of email.subscriptions) {
      const opts = emailOptions[email.email]
      // @ts-expect-error
      if (opts.isUnsubscribed) continue
      accountNotificationOptions[account.id] = {
        notifyAllMentions: account.notifyAllMentions,
        notifyAllReplies: account.notifyAllReplies,
        notifyOwnedDocChange: account.notifyOwnedDocChange,
        notifySiteDiscussions: account.notifySiteDiscussions,
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
      const blob = event.data.value
      try {
        if (blob.blobType === 'Ref') {
          try {
            const unpacked = unpackHmId(blob.resource)
            if (!unpacked?.uid) continue

            const refData = await loadRefFromIpfs(blob.cid)

            const changeCid = refData.heads?.[0]?.toString()

            const changeData = await grpcClient.documents.getDocumentChange({
              id: changeCid,
            })

            const changeDataWithOps = await loadRefFromIpfs(changeCid)

            const changedDoc = await getDocument(unpacked)
            const targetMeta = changedDoc?.metadata ?? {}
            const docUrl = `${SITE_BASE_URL.replace(/\/$/, '')}/hm/${
              unpacked.uid
            }/${(unpacked.path || []).join('/')}`

            const prevVersionId = {
              ...unpacked,
              version:
                changeDataWithOps.deps && changeDataWithOps.deps.length > 0
                  ? changeDataWithOps.deps
                      // @ts-expect-error
                      .map((cid) => cid.toString())
                      .join('.')
                  : null,
            }

            if (prevVersionId) {
              const prevVersionDoc = await getDocument(prevVersionId)
              const mentionsMap = getMentionsFromOps(changeDataWithOps.body.ops)

              const previousMentionsByBlockId: Record<string, Set<string>> = {}

              for (const loaded of prevVersionDoc.content ?? []) {
                const blockId = loaded.block?.id
                if (!blockId) continue

                // @ts-expect-error
                const accountIds = getMentionsFromBlock(loaded.block)
                if (accountIds.size > 0) {
                  previousMentionsByBlockId[blockId] = accountIds
                }
              }

              for (const [blockId, newMentions] of Object.entries(
                mentionsMap,
              )) {
                const oldMentions =
                  previousMentionsByBlockId[blockId] ?? new Set()

                for (const accountLink of newMentions) {
                  const accountId = accountLink.slice('hm://'.length)

                  // Skip if already mentioned in this block in the previous version
                  if (oldMentions.has(accountId)) continue

                  // Skip if a user mentions themselves
                  if (accountId === blob.author) continue

                  const {notifyAllMentions, email} =
                    accountNotificationOptions[accountId] || {}
                  if (!notifyAllMentions) continue

                  const op = changeDataWithOps.body.ops.find(
                    // @ts-expect-error
                    (op) =>
                      op.type === 'ReplaceBlock' && op.block?.id === blockId,
                  )

                  if (!op?.block) continue

                  const blockNode = new BlockNode({
                    block: op.block,
                    children: [],
                  })

                  const authorMeta = (await getAccount(blob.author)).metadata
                  const resolvedNames = await resolveAnnotationNames([
                    blockNode,
                  ])

                  // @ts-expect-error
                  await appendNotification(email, accountId, {
                    type: 'mention',
                    source: 'change',
                    block: blockNode,
                    authorAccountId: blob.author,
                    authorMeta,
                    targetMeta,
                    targetId: unpacked,
                    url: docUrl,
                    resolvedNames,
                  })
                }
              }
            }

            const isNewDocument =
              Array.isArray(changeData.deps) && changeData.deps.length === 0

            for (const accountId in accountNotificationOptions) {
              // @ts-expect-error
              const {notifyOwnedDocChange, email} =
                accountNotificationOptions[accountId]

              if (!notifyOwnedDocChange) continue

              // Skip if the user made their own change
              if (blob.author === accountId) continue

              // Skip if the user is not an owner of a document
              // @ts-expect-error
              const isOwner = changedDoc?.authors?.[accountId]
              if (!isOwner) continue

              const authorMeta = (await getAccount(blob.author)).metadata

              await appendNotification(email, accountId, {
                type: 'change',
                authorAccountId: blob.author,
                authorMeta,
                targetMeta,
                targetId: unpacked,
                url: docUrl,
                isNewDocument: isNewDocument,
              })
            }
          } catch (e) {
            console.error('Error processing Ref event', e)
          }
        }
        if (blob.blobType !== 'Comment') continue
        const comment = await grpcClient.comments.getComment({id: blob.cid})
        const parentComments = await getParentComments(comment)
        const parentAuthors: Set<string> = new Set()
        for (const parentComment of parentComments) {
          if (parentComment.author === comment.targetAccount) continue
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
          commentAuthorMeta: (await getAccount(comment.author)).metadata,
          targetMeta: (
            await getMetadata(
              hmId(comment.targetAccount, {
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
    const comment = newComment.comment
    const targetDocUrl = `${SITE_BASE_URL.replace(/\/$/, '')}/hm/${
      comment.targetAccount
    }${comment.targetPath}`
    const targetDocId = hmId(comment.targetAccount, {
      path: entityQueryPathToHmIdPath(comment.targetPath),
    })

    const ownerId = comment.targetAccount
    const ownerPrefs = accountNotificationOptions[ownerId]

    const isNewDiscussion =
      (!comment.threadRoot || comment.threadRoot === '') &&
      (!comment.replyParent || comment.replyParent === '')

    if (ownerPrefs && comment.author !== ownerId && isNewDiscussion) {
      if (ownerPrefs.notifySiteDiscussions) {
        await appendNotification(ownerPrefs.email, ownerId, {
          type: 'discussion',
          comment,
          parentComments: newComment.parentComments,
          authorMeta: newComment.commentAuthorMeta,
          targetMeta: newComment.targetMeta,
          targetId: targetDocId,
          url: targetDocUrl,
        })
      }
    }

    for (const accountId in accountNotificationOptions) {
      if (comment.author === accountId) continue // don't notify the author for their own comments
      const account = accountNotificationOptions[accountId]

      // @ts-expect-error
      if (account.notifyAllReplies && newComment.parentAuthors.has(accountId)) {
        // @ts-expect-error
        await appendNotification(account.email, accountId, {
          type: 'reply',
          comment: newComment.comment,
          parentComments: newComment.parentComments,
          authorMeta: newComment.commentAuthorMeta,
          targetMeta: newComment.targetMeta,
          targetId: targetDocId,
          url: targetDocUrl,
        })
      }
      // @ts-expect-error
      if (account.notifyAllMentions) {
        if (newComment.mentions.has(accountId)) {
          const resolvedNames = await resolveAnnotationNames(
            newComment.comment.content.map((n) => new BlockNode(n)),
          )
          // @ts-expect-error
          await appendNotification(account.email, accountId, {
            type: 'mention',
            comment: newComment.comment,
            source: 'comment',
            parentComments: newComment.parentComments,
            authorMeta: newComment.commentAuthorMeta,
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
    // @ts-expect-error
    if (opts.isUnsubscribed) continue
    const notificationEmail = await createNotificationsEmail(
      email,
      // @ts-expect-error
      opts,
      notifications,
    )
    if (notificationEmail) {
      const {subject, text, html} = notificationEmail
      console.log('SENDING EMAIL!!!!', email)
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
  // @ts-expect-error
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
    try {
      const parentComment = await grpcClient.comments.getComment({
        id: currentComment.replyParent,
      })
      const parentCommentPlain = toPlainMessage(parentComment)
      parentComments.push(parentCommentPlain)
      currentComment = parentCommentPlain
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

// to load change cid:
//   grpcClient.entities.getChange({
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
    const {events, nextPageToken} = await grpcClient.activityFeed.listEvents({
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
                : `@${unpacked.uid.slice(0, 6)}…`
            } else {
              const meta = await getMetadata(unpacked)
              resolvedNames[annotation.link] = meta.metadata?.name
                ? meta.metadata?.name
                : `@${unpacked.uid.slice(0, 6)}…`
            }
          } catch {
            resolvedNames[annotation.link] = `@${unpacked.uid.slice(0, 6)}…`
          }
        }
      }
    }
  }

  return resolvedNames
}

function getMentionsFromOps(ops: any[]): Record<string, Set<string>> {
  const mentionMap: Record<string, Set<string>> = {}

  for (const op of ops) {
    if (op.type !== 'ReplaceBlock' || !op.block?.annotations) continue

    const mentions = op.block.annotations
      .filter(
        (a: Annotation) => a.type === 'Embed' && a.link?.startsWith('hm://'),
      )
      .map((a: Annotation) => a.link)
    // .map((a: Annotation) => a.link!.slice('hm://'.length))

    if (mentions.length > 0 && op.block.id) {
      mentionMap[op.block.id] = new Set(mentions)
    }
  }

  return mentionMap
}

function getMentionsFromBlock(block: HMLoadedBlock): Set<string> {
  const accountIds = new Set<string>()

  // @ts-expect-error
  if (!block?.content || !Array.isArray(block.content)) return accountIds

  // @ts-expect-error
  for (const item of block.content) {
    if (
      item.type === 'InlineEmbed' &&
      typeof item.ref === 'string' &&
      item.ref.startsWith('hm://')
    ) {
      // Remove hm part of the link
      const ref = item.ref.slice(5)
      if (ref && !ref.includes('/')) {
        accountIds.add(ref)
      }
    }
  }

  return accountIds
}

async function loadRefFromIpfs(cid: string): Promise<any> {
  const url = `${DAEMON_HTTP_URL}/ipfs/${cid}`
  const buffer = await fetch(url).then((res) => res.arrayBuffer())
  return cborDecode(new Uint8Array(buffer))
}
