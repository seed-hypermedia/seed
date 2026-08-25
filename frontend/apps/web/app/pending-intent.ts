import {commentRecordIdFromBlob, createComment, createContact, updateContact} from '@seed-hypermedia/client'
import type {HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import type {NavRoute} from '@shm/shared/routes'
import {routeToUrl} from '@shm/shared/utils/entity-id-url'
import {toast} from '@shm/ui/toast'
import {getCurrentAccountUidWithDelegation, getCurrentSigner} from './auth'
import {clearPendingIntent, getPendingIntent, getStoredLocalKeys} from './local-db'
import {webUniversalClient} from './universal-client'

export type SpaceMembershipStatus = 'not-member' | 'already-joined' | 'own-space'
export type JoinSpaceResult = SpaceMembershipStatus | 'joined'
export type PendingIntentResult =
  | {type: 'none'}
  | {type: 'join'; joinStatus: JoinSpaceResult}
  | {type: 'follow'}
  | {type: 'comment'; commentUrl: string}
  | {type: 'publish-draft'; spaceUrl: string}
  | {type: 'publish-draft-failed'; retryUrl: string}

let pendingIntentProcessingPromise: Promise<PendingIntentResult> | null = null

export async function getSpaceMembershipStatus(spaceUid: string): Promise<SpaceMembershipStatus> {
  const accountUid = await getCurrentAccountUidWithDelegation()
  if (!accountUid) {
    throw new Error('No account UID available to check space membership')
  }
  if (accountUid === spaceUid) {
    return 'own-space'
  }

  const contacts = await webUniversalClient.request('AccountContacts', accountUid)
  const existingContact = contacts.find((c) => c.subject === spaceUid)
  return existingContact?.subscribe?.site ? 'already-joined' : 'not-member'
}

async function joinSpace(signer: HMSigner, spaceUid: string): Promise<JoinSpaceResult> {
  console.log('[joinSpace] Joining space', {spaceUid})
  const membershipStatus = await getSpaceMembershipStatus(spaceUid)
  if (membershipStatus !== 'not-member') {
    console.log('[joinSpace] Space already joined or owned', {spaceUid, membershipStatus})
    return membershipStatus
  }

  const accountUid = await getCurrentAccountUidWithDelegation()
  if (!accountUid) {
    throw new Error('No account UID available to join space')
  }
  const contacts = await webUniversalClient.request('AccountContacts', accountUid)
  console.log('[joinSpace] Existing Contacts', contacts)
  const existingContact = contacts.find((c) => c.subject === spaceUid)
  if (existingContact) {
    console.log('[joinSpace] Updating existing contact to add space subscription', {existingContact})
    const contactPayload = await updateContact(
      {
        contactId: existingContact.id,
        subjectUid: spaceUid,
        accountUid,
        name: existingContact.name,
        subscribe: {...existingContact.subscribe, site: true},
      },
      signer,
    )
    await webUniversalClient.publish(contactPayload)
  } else {
    console.log('[joinSpace] Creating contact for space', {spaceUid, accountUid})
    const contactPayload = await createContact(
      {
        subjectUid: spaceUid,
        accountUid,
        subscribe: {site: true},
      },
      signer,
    )
    await webUniversalClient.publish(contactPayload)
  }

  invalidateQueries([queryKeys.CONTACTS_ACCOUNT, accountUid])
  invalidateQueries([queryKeys.CONTACTS_SUBJECT, spaceUid])
  return 'joined'
}

async function followProfile(signer: HMSigner, profileUid: string) {
  console.log('[followProfile] Following profile', {profileUid})
  const accountUid = await getCurrentAccountUidWithDelegation()
  if (!accountUid) {
    throw new Error('No account UID available to follow profile')
  }
  const contacts = await webUniversalClient.request('AccountContacts', accountUid)
  const existingContact = contacts.find((c) => c.subject === profileUid)

  if (existingContact && (existingContact.subscribe?.profile || !existingContact.subscribe)) {
    console.log('[followProfile] Already following profile', {existingContact})
    return
  }

  if (existingContact) {
    console.log('[followProfile] Updating existing contact to add profile subscription', {existingContact})
    const contactPayload = await updateContact(
      {
        contactId: existingContact.id,
        subjectUid: profileUid,
        accountUid,
        name: existingContact.name,
        subscribe: {...existingContact.subscribe, profile: true},
      },
      signer,
    )
    await webUniversalClient.publish(contactPayload)
  } else {
    const contactPayload = await createContact(
      {
        subjectUid: profileUid,
        accountUid,
        subscribe: {profile: true},
      },
      signer,
    )
    await webUniversalClient.publish(contactPayload)
  }

  invalidateQueries([queryKeys.CONTACTS_ACCOUNT, accountUid])
  invalidateQueries([queryKeys.CONTACTS_SUBJECT, profileUid])
}

/**
 * Process any pending intent saved before auth redirect.
 * Returns the processed intent result, including any comment navigation URL.
 */
export async function processPendingIntent(originHomeId?: UnpackedHypermediaId): Promise<PendingIntentResult> {
  if (pendingIntentProcessingPromise) {
    console.log('[processPendingIntent] Reusing in-flight pending intent processing')
    return pendingIntentProcessingPromise
  }

  pendingIntentProcessingPromise = runProcessPendingIntent(originHomeId).finally(() => {
    pendingIntentProcessingPromise = null
  })

  return pendingIntentProcessingPromise
}

async function runProcessPendingIntent(originHomeId?: UnpackedHypermediaId): Promise<PendingIntentResult> {
  console.log('[processPendingIntent] START. originHomeId:', originHomeId)
  const intent = await getPendingIntent()
  console.log('[processPendingIntent] intent:', intent?.type ?? 'none')
  if (!intent) return {type: 'none'}

  const signer = await getCurrentSigner()
  if (!signer) {
    console.error('No signer available to process pending intent')
    await clearPendingIntent()
    return {type: 'none'}
  }

  if (intent.type === 'join') {
    console.log('[processPendingIntent] Join intent', intent)
    const joinStatus = await joinSpace(signer, intent.subjectUid)
    await clearPendingIntent()
    return {type: 'join', joinStatus}
  }

  if (intent.type === 'follow') {
    console.log('[processPendingIntent] Follow intent', intent)
    await followProfile(signer, intent.profileUid)
    await clearPendingIntent()
    return {type: 'follow'}
  }

  if (intent.type === 'publish-draft') {
    console.log('[processPendingIntent] Publish-draft intent', intent)
    const accountUid = await getCurrentAccountUidWithDelegation()
    if (!accountUid) {
      await clearPendingIntent()
      return {type: 'none'}
    }
    const {adoptPendingSpaceDraft, repointSpaceHomeDraftToAccount} = await import(
      './document-edit/web-create-space-draft'
    )
    try {
      const {publishWebDocument} = await import('./document-edit/web-document-actors')
      // Re-key the anonymous home draft to the new account, then publish it.
      const homeId = await adoptPendingSpaceDraft(intent.draftId, accountUid)
      if (!homeId) {
        await clearPendingIntent()
        return {type: 'none'}
      }
      await publishWebDocument(
        {
          documentId: homeId,
          draftId: intent.draftId,
          deps: [],
          metadata: {},
          navigation: undefined,
          publishAccountUid: accountUid,
          deletedChildDraftIds: [],
        },
        {
          docId: homeId,
          getEditor: () => null,
          client: webUniversalClient,
          getSigner: (uid) => {
            if (!webUniversalClient.getSigner) throw new Error('No signer available for publish')
            return webUniversalClient.getSigner(uid)
          },
          getCapabilityCid: () => undefined,
          onPublishSuccess: () => {},
        },
      )
      await clearPendingIntent()
      return {type: 'publish-draft', spaceUrl: `/hm/${accountUid}`}
    } catch (e) {
      console.error('Failed to process publish-draft intent:', e)
      toast.error('Your account was created, but publishing your space failed. You can try publishing again.')
      await clearPendingIntent()
      // Re-point the home draft to a placeholder edit route
      // under the new account and redirect there for retry.
      const retryUrl = await repointSpaceHomeDraftToAccount(intent.draftId, accountUid)
      if (retryUrl) return {type: 'publish-draft-failed', retryUrl}
      return {type: 'none'}
    }
  }

  if (intent.type === 'comment') {
    console.log('[processPendingIntent] Comment intent', intent)
    const targetSpaceUid = intent.docId.uid
    if (targetSpaceUid) {
      await joinSpace(signer, targetSpaceUid)
    }
    console.log('[processPendingIntent] Creating comment')
    try {
      const storedKeys = await getStoredLocalKeys()
      if (!storedKeys) {
        console.warn('No key pair available to process pending comment intent')
        await clearPendingIntent()
        return {type: 'none'}
      }

      const {docId, content} = intent
      const commentPayload = await createComment(
        {
          docId,
          docVersion: intent.docVersion,
          content,
          replyCommentVersion: intent.replyCommentVersion,
          rootReplyCommentVersion: intent.rootReplyCommentVersion,
          quoting: intent.quotingBlockId ? {blockId: intent.quotingBlockId, range: intent.quotingRange} : undefined,
        },
        signer,
      )

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

      clearCommentDraft(docId.id, intent.replyCommentId, intent.quotingBlockId, intent.quotingRange)
      await clearPendingIntent()

      const commentRoute: NavRoute = {
        key: 'comments',
        id: docId,
        openComment: recordId,
      }
      const commentUrl = routeToUrl(commentRoute, {hostname: null, originHomeId})
      if (!commentUrl) {
        throw new Error('Failed to build comment URL')
      }
      console.log('[processPendingIntent] END. commentRoute:', commentRoute)
      return {type: 'comment', commentUrl}
    } catch (e) {
      console.error('Failed to process pending comment intent:', e)
      await clearPendingIntent()
      return {type: 'none'}
    }
  }

  return {type: 'none'}
}

function clearCommentDraft(
  docId: string,
  replyCommentId?: string | null,
  quotingBlockId?: string,
  quotingRange?: {start: number; end: number},
) {
  const parts = ['comment-draft', docId]
  if (replyCommentId) parts.push(`reply-${replyCommentId}`)
  if (quotingBlockId) parts.push(`quote-${quotingBlockId}`)
  if (quotingRange) parts.push(`range-${quotingRange.start}-${quotingRange.end}`)
  const key = parts.join('-')
  try {
    localStorage.removeItem(key)
  } catch {
    // Ignore — localStorage may not be available
  }
}
