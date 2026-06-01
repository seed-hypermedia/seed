/**
 * IndexedDB-backed draft store for document web editing.
 *
 * Drafts are local-only and survive reload. They contain the editor blocks plus
 * the rest of the document-machine draft payload, keyed by `draftId`. A secondary
 * index on `docId` lets us look up the latest draft for a document on mount.
 */

import type {
  HMBlockNode,
  HMMetadata,
  HMNavigationItem,
  HMResourceVisibility,
} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMListedDraftWithLocation} from '@shm/shared/draft-breadcrumb-context'

export interface WebDocDraft {
  /** Primary key — stable id assigned on first save. */
  draftId: string
  /** Document id (`docId.id` form) this draft targets. Used for the docId index. */
  docId: string
  /** Vault-delegated account UID that will sign the publish. */
  signingAccountId: string
  /** Capability CID used by non-owner publishes. */
  capabilityCid?: string
  /** Editor blocks at the time of last save. */
  content: HMBlockNode[]
  /** Pending metadata changes for this draft (subset of HMMetadata). */
  metadata: HMMetadata | Record<string, unknown>
  /** Heads we will use as `baseVersion` on publish. */
  deps: string[]
  /** Pending navigation override, or null if untouched. */
  navigation: HMNavigationItem[] | null
  /** Location uid for path moves; null when not moving. */
  locationUid: string | null
  /** Location path for moves. */
  locationPath: string[] | null
  /** Edit uid (target account when editing through a capability). */
  editUid: string | null
  /** Edit path under that account. */
  editPath: string[] | null
  /** Draft document visibility. Defaults to public for older records. */
  visibility?: HMResourceVisibility
  /** Cursor offset to restore on re-entering editing. */
  cursorPosition: number | null
  /** Wall-clock timestamp of last save. Used for cleanup. */
  updatedAt: number
}

const DB_NAME = 'web-doc-drafts-01'
const DB_VERSION = 1
const STORE = 'drafts-01'
const INDEX_DOC = 'docId'
const INDEX_UPDATED = 'updatedAt'

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

let dbPromise: Promise<IDBDatabase> | null = null

function isBrowser(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error('IndexedDB unavailable'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {keyPath: 'draftId'})
        store.createIndex(INDEX_DOC, 'docId', {unique: false})
        store.createIndex(INDEX_UPDATED, 'updatedAt', {unique: false})
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE))
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Read a draft by id. Returns null on miss or in non-browser environments. */
export async function getWebDocDraft(draftId: string): Promise<WebDocDraft | null> {
  if (!isBrowser()) return null
  try {
    const store = await tx('readonly')
    const result = await reqToPromise<WebDocDraft | undefined>(store.get(draftId))
    return result ?? null
  } catch (err) {
    console.warn('getWebDocDraft failed', err)
    return null
  }
}

/** Write or replace a draft. Stamps `updatedAt`. */
export async function putWebDocDraft(draft: Omit<WebDocDraft, 'updatedAt'> & {updatedAt?: number}): Promise<void> {
  if (!isBrowser()) return
  const record: WebDocDraft = {...draft, updatedAt: draft.updatedAt ?? Date.now()}
  const store = await tx('readwrite')
  await reqToPromise(store.put(record))
}

/** Delete a draft by id. Idempotent. */
export async function deleteWebDocDraft(draftId: string): Promise<void> {
  if (!isBrowser()) return
  const store = await tx('readwrite')
  await reqToPromise(store.delete(draftId))
}

/**
 * Return all drafts located under `parentLocationUid` + `parentLocationPath`,
 * newest first. Used by the query-block draft slot to render inline child
 * draft cards under the query target.
 */
export async function listWebDocChildDrafts(
  parentLocationUid: string,
  parentLocationPath: string[],
): Promise<WebDocDraft[]> {
  if (!isBrowser()) return []
  try {
    const store = await tx('readonly')
    const all = await reqToPromise<WebDocDraft[]>(store.getAll())
    return all
      .filter(
        (draft) =>
          draft.locationUid === parentLocationUid &&
          pathEquals(draft.locationPath ?? [], parentLocationPath),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (err) {
    console.warn('listWebDocChildDrafts failed', err)
    return []
  }
}

function pathEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Adapt the stored web draft record to the shared `HMListedDraftWithLocation`
 * shape so providers can hand drafts to shared editor + query-block UIs that
 * already speak the desktop draft list shape.
 */
export function webDraftToListedDraft(draft: WebDocDraft): HMListedDraftWithLocation {
  const locationUid = draft.locationUid ?? undefined
  const editUid = draft.editUid ?? undefined
  const locationPath = draft.locationPath ?? undefined
  const editPath = draft.editPath ?? undefined
  return {
    id: draft.draftId,
    locationUid,
    locationPath,
    editUid,
    editPath,
    metadata: (draft.metadata ?? {}) as HMMetadata,
    visibility: draft.visibility ?? 'PUBLIC',
    deps: draft.deps,
    navigation: draft.navigation ?? undefined,
    lastUpdateTime: draft.updatedAt,
    locationId: locationUid ? hmId(locationUid, {path: locationPath ?? []}) : undefined,
    editId: editUid ? hmId(editUid, {path: editPath ?? []}) : undefined,
  } as HMListedDraftWithLocation
}

/** Return all drafts for a given docId, newest first. */
export async function listWebDocDraftsForDoc(docId: string): Promise<WebDocDraft[]> {
  if (!isBrowser()) return []
  try {
    const store = await tx('readonly')
    const index = store.index(INDEX_DOC)
    const results = await reqToPromise<WebDocDraft[]>(index.getAll(docId))
    return results.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (err) {
    console.warn('listWebDocDraftsForDoc failed', err)
    return []
  }
}

/** Return the latest draft for a docId, or null. */
export async function getLatestWebDocDraftForDoc(docId: string): Promise<WebDocDraft | null> {
  const drafts = await listWebDocDraftsForDoc(docId)
  return drafts[0] ?? null
}

/** Delete drafts older than `maxAgeMs` (default 30 days). */
export async function cleanupOldWebDocDrafts(maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<number> {
  if (!isBrowser()) return 0
  try {
    const cutoff = Date.now() - maxAgeMs
    const store = await tx('readwrite')
    const index = store.index(INDEX_UPDATED)
    const range = IDBKeyRange.upperBound(cutoff)
    const oldKeys = await reqToPromise<IDBValidKey[]>(index.getAllKeys(range))
    let deleted = 0
    for (const key of oldKeys) {
      await reqToPromise(store.delete(key))
      deleted += 1
    }
    return deleted
  } catch (err) {
    console.warn('cleanupOldWebDocDrafts failed', err)
    return 0
  }
}

/** Reset cached DB handle (test helper). */
export function _resetWebDocDraftDBForTesting(): void {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => {})
  }
  dbPromise = null
}
