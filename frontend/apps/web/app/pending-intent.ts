import {commentRecordIdFromBlob, createComment, createContact, updateContact} from '@seed-hypermedia/client'
import type {HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import type {NavRoute} from '@shm/shared/routes'
import {routeToUrl} from '@shm/shared/utils/entity-id-url'
import {getCurrentAccountUidWithDelegation, getCurrentSigner} from './auth'
import {clearPendingIntent, getPendingIntent, getStoredLocalKeys} from './local-db'
import {webUniversalClient} from './universal-client'

export type SiteMembershipStatus = 'not-member' | 'already-joined' | 'own-site'
export type JoinSiteResult = SiteMembershipStatus | 'joined'
export type PendingIntentResult =
  | {type: 'none'}
  | {type: 'join'; joinStatus: JoinSiteResult}
  | {type: 'follow'}
  | {type: 'comment'; commentUrl: string}

let pendingIntentProcessingPromise: Promise<PendingIntentResult> | null = null

export async function getSiteMembershipStatus(siteUid: string): Promise<SiteMembershipStatus> {
  const accountUid = await getCurrentAccountUidWithDelegation()
  if (!accountUid) {
    throw new Error('No account UID available to check site membership')
  }
  if (accountUid === siteUid) {
    return 'own-site'
  }

  const contacts = await webUniversalClient.request('AccountContacts', accountUid)
  const existingContact = contacts.find((c) => c.subject === siteUid)
  return existingContact?.subscribe?.site ? 'already-joined' : 'not-member'
}

async function joinSite(signer: HMSigner, siteUid: string): Promise<JoinSiteResult> {
  console.log('[joinSite] Joining site', {siteUid})
  const membershipStatus = await getSiteMembershipStatus(siteUid)
  if (membershipStatus !== 'not-member') {
    console.log('[joinSite] Site already joined or owned', {siteUid, membershipStatus})
    return membershipStatus
  }

  const accountUid = await getCurrentAccountUidWithDelegation()
  if (!accountUid) {
    throw new Error('No account UID available to join site')
  }
  const contacts = await webUniversalClient.request('AccountContacts', accountUid)
  console.log('[joinSite] Existing Contacts', contacts)
  const existingContact = contacts.find((c) => c.subject === siteUid)
  if (existingContact) {
    console.log('[joinSite] Updating existing contact to add site subscription', {existingContact})
    const contactPayload = await updateContact(
      {
        contactId: existingContact.id,
        subjectUid: siteUid,
        accountUid,
        name: existingContact.name,
        subscribe: {...existingContact.subscribe, site: true},
      },
      signer,
    )
    await webUniversalClient.publish(contactPayload)
  } else {
    console.log('[joinSite] Creating contact for site', {siteUid, accountUid})
    const contactPayload = await createContact(
      {
        subjectUid: siteUid,
        accountUid,
        subscribe: {site: true},
      },
      signer,
    )
    await webUniversalClient.publish(contactPayload)
  }

  invalidateQueries([queryKeys.CONTACTS_ACCOUNT, accountUid])
  invalidateQueries([queryKeys.CONTACTS_SUBJECT, siteUid])
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
    const joinStatus = await joinSite(signer, intent.subjectUid)
    await clearPendingIntent()
    return {type: 'join', joinStatus}
  }

  if (intent.type === 'follow') {
    console.log('[processPendingIntent] Follow intent', intent)
    await followProfile(signer, intent.profileUid)
    await clearPendingIntent()
    return {type: 'follow'}
  }

  if (intent.type === 'comment') {
    console.log('[processPendingIntent] Comment intent', intent)
    const targetSiteUid = intent.docId.uid
    if (targetSiteUid) {
      await joinSite(signer, targetSiteUid)
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
