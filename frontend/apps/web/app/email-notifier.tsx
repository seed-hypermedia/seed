import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {createNotificationsEmail, Notification} from '@shm/emails/notifier'
import {
  BlockNode,
  Comment,
  entityQueryPathToHmIdPath,
  Event,
  HMBlockNodeSchema,
  HMDocumentMetadataSchema,
  hmId,
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
import {getAccount, getComment, getDocument, getMetadata} from './loaders'
import {sendEmail} from './mailer'

// Lock to prevent concurrent processing
let isProcessing = false

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
  // Prevent concurrent processing
  if (isProcessing) {
    console.log('~~ skipping - already processing notifications')
    return
  }

  isProcessing = true
  try {
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

    const newLastProcessedBlobCid = getNotifierLastProcessedBlobCid()
    console.log(
      '~~ handleEmailNotifications newLastProcessedBlobCid',
      newLastProcessedBlobCid,
    )
  } finally {
    isProcessing = false
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
      notifySiteDiscussions: boolean
      notifyOwnedDocChange: boolean
      notifyAllComments: boolean
      emails: string[]
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
      try {
        accountMetas[accountId] = (await getAccount(accountId)).metadata
      } catch (error) {
        console.error(`Error getting account ${accountId}:`, error)
        accountMetas[accountId] = null
      }
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

      if (!accountNotificationOptions[account.id]) {
        accountNotificationOptions[account.id] = {
          notifyAllMentions: account.notifyAllMentions,
          notifyAllReplies: account.notifyAllReplies,
          notifySiteDiscussions: account.notifySiteDiscussions,
          notifyOwnedDocChange: account.notifyOwnedDocChange,
          notifyAllComments: account.notifyAllComments,
          emails: [],
        }
      }

      if (
        !accountNotificationOptions[account.id]!.emails.includes(email.email)
      ) {
        accountNotificationOptions[account.id]!.emails.push(email.email)
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

            // if (prevVersionId) {
            //   const prevVersionDoc = await getDocument(prevVersionId)
            //   const mentionsMap = getMentionsFromOps(changeDataWithOps.body.ops)

            //   const previousMentionsByBlockId: Record<string, Set<string>> = {}

            //   for (const loaded of prevVersionDoc.content ?? []) {
            //     const blockId = loaded.block?.id
            //     if (!blockId) continue

            //     // @ts-expect-error
            //     const accountIds = getMentionsFromBlock(loaded.block)
            //     if (accountIds.size > 0) {
            //       previousMentionsByBlockId[blockId] = accountIds
            //     }
            //   }

            //   for (const [blockId, newMentions] of Object.entries(
            //     mentionsMap,
            //   )) {
            //     const oldMentions =
            //       previousMentionsByBlockId[blockId] ?? new Set()

            //     for (const accountLink of newMentions) {
            //       const accountId = accountLink.slice('hm://'.length)

            //       // Skip if already mentioned in this block in the previous version
            //       if (oldMentions.has(accountId)) continue

            //       // Skip if a user mentions themselves
            //       if (accountId === blob.author) continue

            //       const {notifyAllMentions, email} =
            //         accountNotificationOptions[accountId] || {}
            //       if (!notifyAllMentions) continue

            //       const op = changeDataWithOps.body.ops.find(
            //         // @ts-expect-error
            //         (op) =>
            //           op.type === 'ReplaceBlock' && op.block?.id === blockId,
            //       )

            //       if (!op?.block) continue

            //       const blockNode = new BlockNode({
            //         block: op.block,
            //         children: [],
            //       })

            //       const authorMeta = (await getAccount(blob.author)).metadata
            //       const resolvedNames = await resolveAnnotationNames([
            //         blockNode,
            //       ])

            //       // @ts-expect-error
            //       await appendNotification(email, accountId, {
            //         type: 'mention',
            //         source: 'change',
            //         block: blockNode,
            //         authorAccountId: blob.author,
            //         authorMeta,
            //         targetMeta,
            //         targetId: unpacked,
            //         url: docUrl,
            //         resolvedNames,
            //       })
            //     }
            //   }
            // }

            const isNewDocument =
              Array.isArray(changeData.deps) && changeData.deps.length === 0

            // Check if there are previous mentions to compare against
            if (prevVersionId) {
              const prevVersionDoc = await getDocument(prevVersionId)
              const mentionsMap = getMentionsFromOps(changeDataWithOps.body.ops)

              const previousMentionsByBlockId: Record<string, Set<string>> = {}

              for (const loaded of prevVersionDoc.content ?? []) {
                const blockId = loaded.block?.id
                if (!blockId) continue

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
                  // if (accountId === blob.author) continue

                  const account = accountNotificationOptions[accountId]
                  if (!account?.notifyAllMentions) continue

                  const authorMeta = (await getAccount(blob.author)).metadata

                  // Send notification to all emails subscribed to this account
                  for (const email of account.emails) {
                    console.log(
                      `~~ document mention check: ${accountId} (${email}) - mention: true`,
                    )

                    await appendNotification(email, accountId, {
                      type: 'mention',
                      source: 'document',
                      authorAccountId: blob.author,
                      authorMeta,
                      targetMeta,
                      targetId: unpacked,
                      url: docUrl,
                    })
                  }
                }
              }
            }

            // Notify users subscribed to the document's site for document changes
            for (const accountId in accountNotificationOptions) {
              // Only notify users subscribed to this document's site
              if (accountId !== unpacked.uid) continue

              const account = accountNotificationOptions[accountId]
              if (!account) continue

              const {notifyOwnedDocChange, emails} = account

              if (!notifyOwnedDocChange) continue

              const authorMeta = (await getAccount(blob.author)).metadata

              // Send notification to all emails subscribed to this account
              for (const email of emails) {
                console.log(
                  `~~ document change check: ${accountId} (${email}) - document change: true`,
                )

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
            }
          } catch (e) {
            console.error('Error processing Ref event', e)
          }
        }
        if (blob.blobType !== 'Comment') continue
        const comment = await grpcClient.comments.getComment({id: blob.cid})
        const parentComments = await getParentComments(comment)
        let commentAuthorMeta = null
        let targetMeta = null

        try {
          commentAuthorMeta = (await getAccount(comment.author)).metadata
        } catch (error) {
          console.error(
            `Error getting comment author ${comment.author}:`,
            error,
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
        } catch (error) {
          console.error(
            `Error getting target metadata for ${comment.targetAccount}:`,
            error,
          )
        }

        newComments.push({
          comment: toPlainMessage(comment),
          parentComments,
          parentAuthors: new Set(), // Not used anymore
          commentAuthorMeta,
          targetMeta,
          mentions: new Set(), // Not used anymore
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

    // const ownerId = comment.targetAccount
    // const ownerPrefs = accountNotificationOptions[ownerId]

    // const isNewDiscussion =
    //   (!comment.threadRoot || comment.threadRoot === '') &&
    //   (!comment.replyParent || comment.replyParent === '')

    // // Send notifications to all subscribers who want to be notified about site discussions
    // if (isNewDiscussion) {
    //   for (const accountId in accountNotificationOptions) {
    //     // @ts-expect-error
    //     const {notifySiteDiscussions, email} =
    //       accountNotificationOptions[accountId]

    //     if (!notifySiteDiscussions) continue
    //     if (comment.author === accountId) continue // don't notify the author for their own discussions

    //     await appendNotification(email, accountId, {
    //       type: 'discussion',
    //       comment,
    //       parentComments: newComment.parentComments,
    //       authorMeta: newComment.commentAuthorMeta,
    //       targetMeta: newComment.targetMeta,
    //       targetId: targetDocId,
    //       url: targetDocUrl,
    //     })
    //   }
    // }

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
      } catch (error) {
        console.error(
          `Error getting parent comment ${comment.replyParent}:`,
          error,
        )
      }
    }

    for (const accountId in accountNotificationOptions) {
      const account = accountNotificationOptions[accountId]

      const isNewDiscussion =
        (!comment.threadRoot || comment.threadRoot === '') &&
        (!comment.replyParent || comment.replyParent === '')

      let shouldNotify = false
      let notificationReason = ''

      // Notify users subscribed to this site
      if (
        accountId === comment.targetAccount &&
        account?.notifySiteDiscussions
      ) {
        shouldNotify = true
        notificationReason = 'site discussion'
      }

      // Notify users subscribed to the comment author

      // Notify users subscribed to mentioned users
      if (mentionedUsers.has(accountId) && account?.notifyAllMentions) {
        shouldNotify = true
        notificationReason = 'mention'
      }

      // Notify users subscribed to the parent comment author
      if (parentCommentAuthor === accountId && account?.notifyAllReplies) {
        shouldNotify = true
        notificationReason = 'reply'
      }

      if (!shouldNotify || !account) continue

      // Send notification to all emails subscribed to this account
      for (const email of account.emails) {
        console.log(
          `~~ ${notificationReason} check: ${accountId} (${email}) - ${notificationReason}: true`,
        )

        // Create notification based on the reason
        if (notificationReason === 'mention') {
          await appendNotification(email, accountId, {
            type: 'mention',
            authorAccountId: comment.author,
            authorMeta: newComment.commentAuthorMeta,
            targetMeta: newComment.targetMeta,
            targetId: targetDocId,
            url: targetDocUrl,
            source: 'comment',
            comment: newComment.comment,
            resolvedNames: await resolveAnnotationNames(
              newComment.comment.content.map((n) => new BlockNode(n)),
            ),
          })
        } else if (notificationReason === 'reply') {
          await appendNotification(email, accountId, {
            type: 'reply',
            comment: newComment.comment,
            parentComments: newComment.parentComments,
            authorMeta: newComment.commentAuthorMeta,
            targetMeta: newComment.targetMeta,
            targetId: targetDocId,
            url: targetDocUrl,
            resolvedNames: await resolveAnnotationNames(
              newComment.comment.content.map((n) => new BlockNode(n)),
            ),
          })
        } else {
          // Site discussion or user comment
          await appendNotification(email, accountId, {
            type: 'comment',
            comment: newComment.comment,
            parentComments: newComment.parentComments,
            authorMeta: newComment.commentAuthorMeta,
            targetMeta: newComment.targetMeta,
            targetId: targetDocId,
            url: targetDocUrl,
            resolvedNames: await resolveAnnotationNames(
              newComment.comment.content.map((n) => new BlockNode(n)),
            ),
          })
        }
      }
    }

    // Notify users who are subscribed to the comment author
    for (const email of allEmails) {
      for (const subscription of email.subscriptions) {
        // Check if this subscription is for the comment author and has notifyAllComments enabled
        if (
          subscription.id === comment.author &&
          subscription.notifyAllComments
        ) {
          console.log(
            `~~ user comment check: ${comment.author} (${email.email}) - user comment: true`,
          )

          await appendNotification(email.email, comment.author, {
            type: 'comment',
            comment: newComment.comment,
            parentComments: newComment.parentComments,
            authorMeta: newComment.commentAuthorMeta,
            targetMeta: newComment.targetMeta,
            targetId: targetDocId,
            url: targetDocUrl,
            resolvedNames: await resolveAnnotationNames(
              newComment.comment.content.map((n) => new BlockNode(n)),
            ),
          })
        }
      }
    }
  }
  const emailsToSend = Object.entries(notificationsToSend)
  console.log('~~ emailsToSend count:', emailsToSend.length)
  for (const [email, notifications] of emailsToSend) {
    const opts = emailOptions[email]
    // @ts-expect-error
    if (opts.isUnsubscribed) continue
    console.log(
      `~~ processing email ${email} with ${notifications.length} notifications`,
    )
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
  console.log('~~ markEventsAsProcessed setting CID to:', lastProcessedBlobCid)
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
      .filter((a: any) => a.type === 'Embed' && a.link?.startsWith('hm://'))
      .map((a: any) => a.link)

    if (mentions.length > 0 && op.block.id) {
      mentionMap[op.block.id] = new Set(mentions)
    }
  }

  return mentionMap
}

function getMentionsFromBlock(block: any): Set<string> {
  const accountIds = new Set<string>()

  if (!block?.content || !Array.isArray(block.content)) return accountIds

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
