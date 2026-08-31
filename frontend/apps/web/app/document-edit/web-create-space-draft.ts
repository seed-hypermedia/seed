import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {PENDING_SPACE_UID_PREFIX} from '@shm/shared/utils/pending-space'
import {nanoid} from 'nanoid'
import {deleteWebDocDraft, getWebDocDraft, putWebDocDraft} from './web-draft-db'

export {isPendingSpaceUid} from '@shm/shared/utils/pending-space'

// Tracks which local draft ids are pending home drafts. Kept in
// localStorage so the editor's autosave, which
// rewrites the draft's editPath, can't erase the marker.
const SPACE_HOME_DRAFT_IDS_KEY = 'space-home-draft-ids'

function readSpaceHomeDraftIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(localStorage.getItem(SPACE_HOME_DRAFT_IDS_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function markSpaceHomeDraftId(draftId: string): void {
  if (typeof localStorage === 'undefined') return
  const ids = readSpaceHomeDraftIds()
  ids.add(draftId)
  try {
    localStorage.setItem(SPACE_HOME_DRAFT_IDS_KEY, JSON.stringify([...ids]))
  } catch {
    // Ignore — localStorage may be unavailable.
  }
}

function unmarkSpaceHomeDraftId(draftId: string): void {
  if (typeof localStorage === 'undefined') return
  const ids = readSpaceHomeDraftIds()
  if (!ids.delete(draftId)) return
  try {
    localStorage.setItem(SPACE_HOME_DRAFT_IDS_KEY, JSON.stringify([...ids]))
  } catch {}
}

// True when a local draft id is a "create a space" home draft.
export function isSpaceHomeDraftId(draftId: string | null | undefined): boolean {
  return !!draftId && readSpaceHomeDraftIds().has(draftId)
}

// Discard an abandoned pending space home draft.
export async function discardSpaceHomeDraft(draftId: string): Promise<void> {
  await deleteWebDocDraft(draftId)
  unmarkSpaceHomeDraftId(draftId)
}

export type PendingSpaceHomeDraft = {
  // Persistent local draft id, used to adopt the draft after sign-in.
  draftId: string
  // Route id for the editor.
  id: UnpackedHypermediaId
  // Web URL to navigate to so the editor opens on this draft.
  webPath: string
}

/**
 * Create a local home draft, edited via a `-<draftId>` placeholder route.
 * `editPath: []` marks it as a home doc for publish.
 */
export async function createSpaceHomeDraft(
  metadata: Partial<HMMetadata>,
  accountUid?: string | null,
): Promise<PendingSpaceHomeDraft> {
  const uid = accountUid || `${PENDING_SPACE_UID_PREFIX}${nanoid(10)}`
  const draftId = nanoid(10)
  const id = hmId(uid, {path: [`-${draftId}`]})
  await putWebDocDraft({
    draftId,
    docId: id.id,
    signingAccountId: accountUid || '', // empty when signed out
    content: [],
    metadata,
    deps: [],
    navigation: null,
    locationUid: uid,
    locationPath: [],
    editUid: uid,
    editPath: [], // home doc target for publish
    cursorPosition: null,
    visibility: 'PUBLIC',
  })
  markSpaceHomeDraftId(draftId)
  return {draftId, id, webPath: `/hm/${uid}/-${draftId}`}
}

/**
 * Re-key a pending home draft to a real account after sign-in and return the
 * real home doc id. The draft keeps its content/metadata and only the identity
 * fields change, so the existing editor/publish pipeline can own and publish it.
 */
export async function adoptPendingSpaceDraft(
  pendingDraftId: string,
  accountUid: string,
): Promise<UnpackedHypermediaId | null> {
  const draft = await getWebDocDraft(pendingDraftId)
  if (!draft) return null
  const homeId = hmId(accountUid, {path: []})
  await putWebDocDraft({
    ...draft,
    docId: homeId.id,
    signingAccountId: accountUid,
    locationUid: accountUid,
    locationPath: [],
    editUid: accountUid,
    editPath: [],
  })
  return homeId
}

/**
 * After a failed publish, re-point the home draft to a
 * placeholder edit route under the new account and
 * return the web path to navigate to.
 */
export async function repointSpaceHomeDraftToAccount(draftId: string, accountUid: string): Promise<string | null> {
  const draft = await getWebDocDraft(draftId)
  if (!draft) return null
  const editId = hmId(accountUid, {path: [`-${draftId}`]})
  await putWebDocDraft({
    ...draft,
    docId: editId.id,
    signingAccountId: accountUid,
    locationUid: accountUid,
    locationPath: [],
    editUid: accountUid,
    editPath: [], // still publishes to the home path
  })
  markSpaceHomeDraftId(draftId)
  return `/hm/${accountUid}/-${draftId}`
}
