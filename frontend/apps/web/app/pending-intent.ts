import {commentRecordIdFromBlob, createComment, createContact, createSeedClient} from '@seed-hypermedia/client'
import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import type {NavRoute} from '@shm/shared/routes'
import {routeToUrl} from '@shm/shared/utils/entity-id-url'
import {getCurrentSigner} from './auth'
import {clearPendingIntent, getPendingIntent, getStoredLocalKeys} from './local-db'

const seedClient = createSeedClient('')

/**
 * Process any pending intent saved before auth redirect.
 * Returns a relative URL path to navigate to (for comment intents), or null.
 */
export async function processPendingIntent(originHomeId?: UnpackedHypermediaId): Promise<string | null> {
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
    console.log('[processPendingIntent] Creating "join" contact')

    const contactPayload = await createContact(
      {
        subjectUid: intent.subjectUid,
        // accountUid: intent.accountUid,
        name: '',
      },
      signer,
    )
    // await seedClient.publish(contactPayload)

    await clearPendingIntent()
    return null
  }

  if (intent.type === 'comment') {
    console.log('[processPendingIntent] Creating comment')
    try {
      const storedKeys = await getStoredLocalKeys()
      if (!storedKeys) {
        console.warn('No key pair available to process pending comment intent')
        await clearPendingIntent()
        return null
      }

      // const publicKeyRaw = await preparePublicKey(storedKeys.keyPair.publicKey)

      // const signer: HMSigner = {
      //   getPublicKey: async () => publicKeyRaw,
      //   sign: async (data: Uint8Array) => {
      //     const sig = await crypto.subtle.sign(
      //       {...storedKeys.keyPair.privateKey.algorithm, hash: {name: 'SHA-256'}},
      //       storedKeys.keyPair.privateKey,
      //       new Uint8Array(data),
      //     )
      //     return new Uint8Array(sig)
      //   },
      // }

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

      await seedClient.publish(commentPayload)

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
