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

const DB_NAME = 'keyStore-04' // oops, can't change this, ever
const KEYS_STORE_NAME = 'keys-01'
const EMAIL_NOTIFICATIONS_STORE_NAME = 'email-notifications-01'
const DB_VERSION = 5

function initDB(idb?: IDBFactory): Promise<IDBDatabase> {
  console.log('~~ initDB', idb, window.location.origin)
  if (!idb) {
    throw new Error('NoIndexedDB')
  }
  const openDb = idb.open(DB_NAME, DB_VERSION)
  openDb.onupgradeneeded = (event) => {
    // @ts-expect-error
    const db: IDBDatabase = event.target.result
    upgradeStore(db, KEYS_STORE_NAME)
    upgradeStore(db, EMAIL_NOTIFICATIONS_STORE_NAME)
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
  console.log('~ resetDB', idb)
  if (db) {
    ;(await getDB(window.indexedDB)).close()
    console.log('~ db closed')
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

function storePut<T>(
  store: IDBObjectStore,
  value: T,
  key: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = store.put(value, key)
    doGet.onsuccess = (event) => {
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

function storeGetAllKeys(store: IDBObjectStore): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAllKeys()
    r.onsuccess = (event) => {
      // @ts-expect-error
      const keys = event.target.result
      // @ts-expect-error
      resolve(keys.map((v) => v.toString()))
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
      // @ts-expect-error
      resolve(event.target.result)
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

export async function getStoredLocalKeys(): Promise<CryptoKeyPair | null> {
  const store = (await getDB())
    .transaction(KEYS_STORE_NAME)
    .objectStore(KEYS_STORE_NAME)
  const [privateKey, publicKey] = await Promise.all([
    storeGet<CryptoKey>(store, 'privateKey'),
    storeGet<CryptoKey>(store, 'publicKey'),
  ])
  return privateKey && publicKey ? {privateKey, publicKey} : null
}

export async function writeLocalKeys(keyPair: CryptoKeyPair): Promise<void> {
  const store = (await getDB())
    .transaction(KEYS_STORE_NAME, 'readwrite')
    .objectStore(KEYS_STORE_NAME)
  console.log('~! writeLocalKeys', keyPair)
  await Promise.all([
    storePut(store, keyPair.privateKey, 'privateKey'),
    storePut(store, keyPair.publicKey, 'publicKey'),
  ])
}

export async function deleteLocalKeys() {
  const store = (await getDB())
    .transaction(KEYS_STORE_NAME, 'readwrite')
    .objectStore(KEYS_STORE_NAME)
  await storeClear(store)
}

export async function hasPromptedEmailNotifications(): Promise<boolean> {
  const store = (await getDB())
    .transaction(EMAIL_NOTIFICATIONS_STORE_NAME, 'readonly')
    .objectStore(EMAIL_NOTIFICATIONS_STORE_NAME)
  return (await storeGet<boolean>(store, 'hasPrompted')) ?? false
}

export async function setHasPromptedEmailNotifications(
  hasPrompted: boolean,
): Promise<void> {
  const store = (await getDB())
    .transaction(EMAIL_NOTIFICATIONS_STORE_NAME, 'readwrite')
    .objectStore(EMAIL_NOTIFICATIONS_STORE_NAME)
  await storePut(store, hasPrompted, 'hasPrompted')
}
