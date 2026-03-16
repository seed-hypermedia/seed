import {HMBlockNodeSchema, unpackedHmIdSchema} from '@seed-hypermedia/client/hm-types'
import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {z} from 'zod'

function upgradeStore(db: IDBDatabase, storeName: string, options?: IDBObjectStoreParameters): IDBObjectStore | null {
  if (db.objectStoreNames.contains(storeName)) {
    return null
  }
  return db.createObjectStore(storeName, options)
}

const DB_NAME = 'keyStore-04' // oops, can't change this, ever
const KEYS_STORE_NAME = 'keys-01'
const EMAIL_NOTIFICATIONS_STORE_NAME = 'email-notifications-01'
const AUTH_SESSIONS_STORE_NAME = 'auth-sessions-01'
const AUTH_STATE_STORE_NAME = 'auth-state-01'
const PENDING_INTENT_STORE_NAME = 'pending-intent-01'
const DB_VERSION = 7

export const AUTH_STATE_ACTIVE_VAULT_URL = 'active_vault_url'
export const AUTH_STATE_DELEGATION_RETURN_URL = 'delegation_return_url'
export const AUTH_STATE_DELEGATION_VAULT_URL = 'delegation_vault_url'

export interface DBSessionRecord {
  keyPair: CryptoKeyPair
  publicKeyRaw: Uint8Array
  principal: string
  vaultUrl: string
  createTime: number
  authState: string | null
  authStartTime: number | null
}

function initDB(idb?: IDBFactory): Promise<IDBDatabase> {
  if (!idb) {
    throw new Error('NoIndexedDB')
  }
  const openDb = idb.open(DB_NAME, DB_VERSION)
  openDb.onupgradeneeded = (event) => {
    // @ts-expect-error
    const db: IDBDatabase = event.target.result
    upgradeStore(db, KEYS_STORE_NAME)
    upgradeStore(db, EMAIL_NOTIFICATIONS_STORE_NAME)
    upgradeStore(db, AUTH_SESSIONS_STORE_NAME)
    upgradeStore(db, AUTH_STATE_STORE_NAME)
    upgradeStore(db, PENDING_INTENT_STORE_NAME)
  }
  return new Promise((resolve, reject) => {
    openDb.onsuccess = (event) => {
      resolve(openDb.result)
    }
    openDb.onerror = (error) => {
      console.error('~ error opening db', error)
      reject(error)
    }
  })
}

let db: Promise<IDBDatabase> | null = null

export async function resetDB(idb: IDBFactory) {
  if (db) {
    ;(await getDB(window.indexedDB)).close()
  }
  db = initDB(idb)
  return await db
}

function getDB(idb?: IDBFactory): Promise<IDBDatabase> {
  if (!db) {
    db = initDB(idb || window.indexedDB)
  }
  return db
}

function storeGet<T>(store: IDBObjectStore, key: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const doGet = store.get(key)
    doGet.onsuccess = (event) => {
      // @ts-expect-error
      resolve(event.target?.result)
    }
    doGet.onerror = (error) => {
      reject(error)
    }
  })
}

function storePut<T>(store: IDBObjectStore, value: T, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = store.put(value, key)
    doGet.onsuccess = () => {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        navigator.storage
          .persist()
          .then(() => resolve())
          .catch(() => resolve())
      } else {
        resolve()
      }
    }
    doGet.onerror = (error) => {
      reject(error)
    }
  })
}

function storeClear(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = store.clear()
    r.onsuccess = () => {
      resolve()
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

function storeDelete(store: IDBObjectStore, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = store.delete(key)
    r.onsuccess = () => {
      resolve()
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

// -- Local keys --

export interface StoredLocalKeys {
  keyPair: CryptoKeyPair
  delegatedAccountUid?: string
  vaultUrl?: string
}

export async function getStoredLocalKeys(): Promise<StoredLocalKeys | null> {
  const store = (await getDB()).transaction(KEYS_STORE_NAME).objectStore(KEYS_STORE_NAME)
  const [privateKey, publicKey, delegatedAccountUid, vaultUrl] = await Promise.all([
    storeGet<CryptoKey>(store, 'privateKey'),
    storeGet<CryptoKey>(store, 'publicKey'),
    storeGet<string | undefined>(store, 'delegatedAccountUid'),
    storeGet<string | undefined>(store, 'vaultUrl'),
  ])
  if (!privateKey || !publicKey) return null
  return {
    keyPair: {privateKey, publicKey},
    delegatedAccountUid: delegatedAccountUid ?? undefined,
    vaultUrl: vaultUrl ?? undefined,
  }
}

export async function writeLocalKeys(
  keyPair: CryptoKeyPair,
  options?: {delegatedAccountUid?: string; vaultUrl?: string},
): Promise<void> {
  const store = (await getDB()).transaction(KEYS_STORE_NAME, 'readwrite').objectStore(KEYS_STORE_NAME)
  const writes: Promise<void>[] = [
    storePut(store, keyPair.privateKey, 'privateKey'),
    storePut(store, keyPair.publicKey, 'publicKey'),
  ]
  if (options?.delegatedAccountUid !== undefined) {
    writes.push(storePut(store, options.delegatedAccountUid, 'delegatedAccountUid'))
  }
  if (options?.vaultUrl !== undefined) {
    writes.push(storePut(store, options.vaultUrl, 'vaultUrl'))
  }
  await Promise.all(writes)
}

export async function deleteLocalKeys() {
  const store = (await getDB()).transaction(KEYS_STORE_NAME, 'readwrite').objectStore(KEYS_STORE_NAME)
  await storeClear(store)
}

// -- Email notifications --

export async function hasPromptedEmailNotifications(): Promise<boolean> {
  const store = (await getDB())
    .transaction(EMAIL_NOTIFICATIONS_STORE_NAME, 'readonly')
    .objectStore(EMAIL_NOTIFICATIONS_STORE_NAME)
  return (await storeGet<boolean>(store, 'hasPrompted')) ?? false
}

export async function setHasPromptedEmailNotifications(hasPrompted: boolean): Promise<void> {
  const store = (await getDB())
    .transaction(EMAIL_NOTIFICATIONS_STORE_NAME, 'readwrite')
    .objectStore(EMAIL_NOTIFICATIONS_STORE_NAME)
  await storePut(store, hasPrompted, 'hasPrompted')
}

// -- Auth sessions (replaces hmauth IDB) --

export async function getAuthSession(vaultUrl: string): Promise<DBSessionRecord | undefined> {
  const store = (await getDB()).transaction(AUTH_SESSIONS_STORE_NAME, 'readonly').objectStore(AUTH_SESSIONS_STORE_NAME)
  return await storeGet<DBSessionRecord | undefined>(store, vaultUrl)
}

export async function putAuthSession(vaultUrl: string, record: DBSessionRecord): Promise<void> {
  const store = (await getDB()).transaction(AUTH_SESSIONS_STORE_NAME, 'readwrite').objectStore(AUTH_SESSIONS_STORE_NAME)
  await storePut(store, record, vaultUrl)
}

export async function deleteAuthSession(vaultUrl: string): Promise<void> {
  const store = (await getDB()).transaction(AUTH_SESSIONS_STORE_NAME, 'readwrite').objectStore(AUTH_SESSIONS_STORE_NAME)
  await storeDelete(store, vaultUrl)
}

// -- Auth state (replaces localStorage) --

export async function getAuthState(key: string): Promise<string | null> {
  const store = (await getDB()).transaction(AUTH_STATE_STORE_NAME, 'readonly').objectStore(AUTH_STATE_STORE_NAME)
  return (await storeGet<string | undefined>(store, key)) ?? null
}

export async function setAuthState(key: string, value: string): Promise<void> {
  const store = (await getDB()).transaction(AUTH_STATE_STORE_NAME, 'readwrite').objectStore(AUTH_STATE_STORE_NAME)
  await storePut(store, value, key)
}

export async function deleteAuthState(key: string): Promise<void> {
  const store = (await getDB()).transaction(AUTH_STATE_STORE_NAME, 'readwrite').objectStore(AUTH_STATE_STORE_NAME)
  await storeDelete(store, key)
}

export async function clearAllAuthState(): Promise<void> {
  const store = (await getDB()).transaction(AUTH_STATE_STORE_NAME, 'readwrite').objectStore(AUTH_STATE_STORE_NAME)
  await storeClear(store)
}

// -- Pending intent --

export interface PendingCommentIntent {
  type: 'comment'
  docId: UnpackedHypermediaId
  docVersion: string
  content: HMBlockNode[]
  replyCommentId?: string
  replyCommentVersion?: string
  rootReplyCommentVersion?: string
  quotingBlockId?: string
}

export interface PendingJoinIntent {
  type: 'join'
  subjectUid: string
}

export interface PendingFollowIntent {
  type: 'follow'
  profileUid: string
}

export type PendingIntent = PendingCommentIntent | PendingJoinIntent | PendingFollowIntent

// Zod schemas for validating stored intent data
const PendingCommentIntentSchema = z.object({
  type: z.literal('comment'),
  docId: unpackedHmIdSchema,
  docVersion: z.string(),
  content: z.array(HMBlockNodeSchema),
  replyCommentId: z.string().optional(),
  replyCommentVersion: z.string().optional(),
  rootReplyCommentVersion: z.string().optional(),
  quotingBlockId: z.string().optional(),
})

const PendingJoinIntentSchema = z.object({
  type: z.literal('join'),
  subjectUid: z.string(),
})

const PendingFollowIntentSchema = z.object({
  type: z.literal('follow'),
  profileUid: z.string(),
})

const PendingIntentSchema = z.discriminatedUnion('type', [
  PendingCommentIntentSchema,
  PendingJoinIntentSchema,
  PendingFollowIntentSchema,
])

const PENDING_INTENT_KEY = 'pending'

export async function setPendingIntent(intent: PendingIntent): Promise<void> {
  const store = (await getDB())
    .transaction(PENDING_INTENT_STORE_NAME, 'readwrite')
    .objectStore(PENDING_INTENT_STORE_NAME)
  await storePut(store, intent, PENDING_INTENT_KEY)
}

export async function getPendingIntent(): Promise<PendingIntent | null> {
  const store = (await getDB())
    .transaction(PENDING_INTENT_STORE_NAME, 'readonly')
    .objectStore(PENDING_INTENT_STORE_NAME)
  const raw = await storeGet<unknown>(store, PENDING_INTENT_KEY)
  if (!raw) return null

  const result = PendingIntentSchema.safeParse(raw)
  if (!result.success) {
    console.warn('Invalid pending intent data in IndexedDB, clearing:', result.error.issues)
    // Clear invalid data to avoid repeated failures
    await clearPendingIntent()
    return null
  }
  return result.data
}

export async function clearPendingIntent(): Promise<void> {
  const store = (await getDB())
    .transaction(PENDING_INTENT_STORE_NAME, 'readwrite')
    .objectStore(PENDING_INTENT_STORE_NAME)
  await storeDelete(store, PENDING_INTENT_KEY)
}

// Clean up legacy database from hmauth
if (typeof indexedDB !== 'undefined') {
  indexedDB.deleteDatabase('hypermedia-auth')
}
