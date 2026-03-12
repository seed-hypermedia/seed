import { commentRecordIdFromBlob, createComment, createContact } from '@seed-hypermedia/client'
import type { HMBlockNode, HMSigner, UnpackedHypermediaId } from '@seed-hypermedia/client/hm-types'
import { queryKeys } from '@shm/shared'
import { invalidateQueries } from '@shm/shared/models/query-client'
import type { NavRoute } from '@shm/shared/routes'
import { routeToUrl, unpackHmId } from '@shm/shared/utils/entity-id-url'
import { getCurrentAccountUidWithDelegation, getCurrentSigner } from './auth'
import { clearPendingIntent, getPendingIntent, getStoredLocalKeys } from './local-db'
import { webUniversalClient } from './universal-client'

let pendingIntentProcessingPromise: Promise<string | null> | null = null

async function joinSite(signer: HMSigner, siteUid: string) {
  return // skip auto join for now! TODO bring back
  // check to see if we already have a contact for this site
  const accountUid = await getCurrentAccountUidWithDelegation()
  if (!accountUid) {
    throw new Error('No account UID available to join site')
  }
  const contacts = await webUniversalClient.request('AccountContacts', accountUid)
  const existingContact = contacts.find((c) => c.subject === siteUid)
  if (existingContact) {
    console.log('[joinSite] Already have a contact for this site', {existingContact})
    return
  }
  console.log('[joinSite] Creating contact for site', {siteUid})
  const contactPayload = await createContact(
    {
      subjectUid: siteUid,
      accountUid,
      name: '',
    },
    signer,
  )
  await webUniversalClient.publish(contactPayload)

  invalidateQueries([queryKeys.CONTACTS_ACCOUNT, accountUid])
  invalidateQueries([queryKeys.CONTACTS_SUBJECT, siteUid])
}
/**
 * Process any pending intent saved before auth redirect.
 * Returns a relative URL path to navigate to (for comment intents), or null.
 */
export async function processPendingIntent(originHomeId?: UnpackedHypermediaId): Promise<string | null> {
  if (pendingIntentProcessingPromise) {
    console.log('[processPendingIntent] Reusing in-flight pending intent processing')
    return pendingIntentProcessingPromise
  }

  pendingIntentProcessingPromise = runProcessPendingIntent(originHomeId).finally(() => {
    pendingIntentProcessingPromise = null
  })

  return pendingIntentProcessingPromise
}

async function runProcessPendingIntent(originHomeId?: UnpackedHypermediaId): Promise<string | null> {
  console.log('[processPendingIntent] START. originHomeId:', originHomeId)
  const intent = await getPendingIntent()
  console.log('[processPendingIntent] intent:', intent?.type ?? 'none')
  if (!intent) return null

  const signer = await getCurrentSigner()
  if (!signer) {
    console.error('No signer available to process pending intent')
    await clearPendingIntent()
    return null
  }

  if (intent.type === 'join') {
    await joinSite(signer, intent.subjectUid)

    await clearPendingIntent()
    return null
  }

  if (intent.type === 'comment') {
    const targetSiteUid = unpackHmId(intent.docId)?.uid
    if (targetSiteUid) {
      await joinSite(signer, targetSiteUid)
    }
    console.log('[processPendingIntent] Creating comment')
    try {
      const storedKeys = await getStoredLocalKeys()
      if (!storedKeys) {
        console.warn('No key pair available to process pending comment intent')
        await clearPendingIntent()
        return null
      }

      const docId: UnpackedHypermediaId = JSON.parse(intent.docId)
      const content: HMBlockNode[] = JSON.parse(intent.content)

      const commentPayload = await createComment(
        {
          docId,
          docVersion: intent.docVersion,
          content,
          replyCommentVersion: intent.replyCommentVersion,
          rootReplyCommentVersion: intent.rootReplyCommentVersion,
          quotingBlockId: intent.quotingBlockId,
        },
        signer,
      )

      // Compute the record ID (authority/tsid) from the comment blob before publishing
      const commentBlobData = commentPayload.blobs[0]?.data
      if (!commentBlobData) throw new Error('No comment blob data')
      const recordId = await commentRecordIdFromBlob(commentBlobData)

      await webUniversalClient.publish(commentPayload)

      invalidateQueries([queryKeys.DOCUMENT_ACTIVITY])
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY])
      invalidateQueries([queryKeys.DOC_CITATIONS])
      invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
      invalidateQueries([queryKeys.ACTIVITY_FEED])

      // Clear the comment draft from localStorage
      clearCommentDraft(docId.id, intent.replyCommentId, intent.quotingBlockId)

      await clearPendingIntent()

      // Return relative URL path for navigation using the record ID (authority/tsid)
      const commentRoute: NavRoute = {
        key: 'comments',
        id: docId,
        openComment: recordId,
      }
      console.log('[processPendingIntent] END. commentRoute:', commentRoute)
      return routeToUrl(commentRoute, {hostname: null, originHomeId})
    } catch (e) {
      console.error('Failed to process pending comment intent:', e)
      await clearPendingIntent()
      return null
    }
  }

  return null
}

function clearCommentDraft(docId: string, replyCommentId?: string | null, quotingBlockId?: string) {
  const parts = ['comment-draft', docId]
  if (replyCommentId) parts.push(`reply-${replyCommentId}`)
  if (quotingBlockId) parts.push(`quote-${quotingBlockId}`)
  const key = parts.join('-')
  try {
    localStorage.removeItem(key)
  } catch {
    // Ignore — localStorage may not be available
  }
}
