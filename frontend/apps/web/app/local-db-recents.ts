import {unpackHmId} from '@shm/shared'
import {RecentsResult} from '@shm/shared/models/recents'

const DB_NAME = 'recents-db-01'
const RECENTS_STORE_NAME = 'recents-01'
const DB_VERSION = 1
const MAX_RECENTS = 20

function upgradeStore(
  db: IDBDatabase,
  storeName: string,
  options?: IDBObjectStoreParameters,
): IDBObjectStore | null {
  if (db.objectStoreNames.contains(storeName)) {
    return null
  }
  return db.createObjectStore(storeName, options)
}

function upgradeIndex(
  tx: IDBTransaction,
  storeName: string,
  indexName: string,
  keyPath: string | string[],
  options?: IDBIndexParameters,
): IDBIndex {
  const store = tx.objectStore(storeName)
  if (store.indexNames.contains(indexName)) {
    return store.index(indexName)
  }
  return store.createIndex(indexName, keyPath, options)
}

function initDB(idb?: IDBFactory): Promise<IDBDatabase> {
  if (!idb) {
    throw new Error('NoIndexedDB')
  }
  const openDb = idb.open(DB_NAME, DB_VERSION)
  openDb.onupgradeneeded = (event) => {
    const db = (event.target as IDBOpenDBRequest).result
    const tx = (event.target as IDBOpenDBRequest).transaction
    if (!tx) {
      throw new Error('Transaction is null')
    }

    // Create the recents store with id as keyPath
    const store = upgradeStore(db, RECENTS_STORE_NAME, {keyPath: 'id'})

    // Create an index on time for sorting
    if (store) {
      upgradeIndex(tx, RECENTS_STORE_NAME, 'time', 'time', {
        unique: false,
      })
    }
  }
  return new Promise((resolve, reject) => {
    openDb.onsuccess = () => {
      resolve(openDb.result)
    }
    openDb.onerror = (error) => {
      console.error('Error opening db', error)
      reject(error)
    }
  })
}

let db: Promise<IDBDatabase> | null = null

export async function resetDB(idb: IDBFactory) {
  if (db) {
    const oldDb = await db
    oldDb.close()
    db = null
  }
  db = initDB(idb)
  return await db
}

function getDB(idb = window.indexedDB): Promise<IDBDatabase> {
  if (!db) {
    db = initDB(idb)
  }
  return db
}

function storePut<T>(store: IDBObjectStore, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = store.put(value)
    doGet.onsuccess = () => {
      resolve()
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

function storeIndexGetAll<T>(store: IDBObjectStore | IDBIndex): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAll()
    r.onsuccess = (event) => {
      resolve((event.target as IDBRequest).result)
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

/**
 * Add a recent item to the database
 * @param id The ID of the recent item
 * @param name The name of the recent item
 * @returns The created recent item
 */
export async function addRecent(
  id: string,
  name: string,
): Promise<RecentsResult> {
  const time = Date.now()

  // Store the string ID in the database
  const dbItem = {
    id,
    time,
    name,
  }

  const db = await getDB()
  const tx = db.transaction(RECENTS_STORE_NAME, 'readwrite')
  const store = tx.objectStore(RECENTS_STORE_NAME)

  // Create a promise that resolves when the transaction completes
  const txComplete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  // Add the new item (this will replace any existing item with the same ID)
  await storePut(store, dbItem)

  // Get all items to check if we need to trim
  const index = store.index('time')
  const recents = await storeIndexGetAll<typeof dbItem>(index)
  const sortedRecents = recents.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))

  // Remove older items if we exceed MAX_RECENTS
  if (sortedRecents.length > MAX_RECENTS) {
    const itemsToRemove = sortedRecents.slice(MAX_RECENTS)
    for (const item of itemsToRemove) {
      await storeDelete(store, item.id)
    }
  }

  // Wait for the transaction to complete
  await txComplete

  // Convert the string ID to UnpackedHypermediaId for the return value
  const unpackedId = unpackHmId(id)
  if (!unpackedId) {
    throw new Error(`Invalid hypermedia ID: ${id}`)
  }

  return {
    id: unpackedId,
    time,
    name,
  }
}

/**
 * Get all recent items sorted by time (newest first)
 * @returns Array of recent items
 */
export async function getRecents(): Promise<RecentsResult[]> {
  const db = await getDB()
  const tx = db.transaction(RECENTS_STORE_NAME, 'readonly')
  const store = tx.objectStore(RECENTS_STORE_NAME)

  // Create a promise that resolves when the transaction completes
  const txComplete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  const index = store.index('time')
  const recents: RecentsResult[] = []

  return new Promise<RecentsResult[]>((resolve, reject) => {
    const request = index.openCursor(null, 'prev')
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
        .result
      if (cursor) {
        const dbItem = cursor.value as {
          id: string
          time: number
          name: string
        }
        const unpackedId = unpackHmId(dbItem.id)
        if (unpackedId) {
          recents.push({
            id: unpackedId,
            time: dbItem.time,
            name: dbItem.name,
          })
        }
        cursor.continue()
      } else {
        resolve(recents)
      }
    }
    request.onerror = () => reject(request.error)
  }).finally(() => txComplete)
}

/**
 * Delete a specific recent item by ID
 * @param id The ID of the recent item to delete
 */
export async function deleteRecent(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(RECENTS_STORE_NAME, 'readwrite')
  const store = tx.objectStore(RECENTS_STORE_NAME)

  // Create a promise that resolves when the transaction completes
  const txComplete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  await storeDelete(store, id)

  // Wait for the transaction to complete
  await txComplete
}

/**
 * Clear all recent items
 */
export async function clearRecents(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(RECENTS_STORE_NAME, 'readwrite')
  const store = tx.objectStore(RECENTS_STORE_NAME)

  // Create a promise that resolves when the transaction completes
  const txComplete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  await storeClear(store)

  // Wait for the transaction to complete
  await txComplete
}
